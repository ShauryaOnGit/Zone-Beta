"""
Pixel/Hash Gate — a lightweight pre-filter that sits in front of an
expensive vision-language model (VLM) call. It decides whether an
incoming frame/image is different enough from what's already been seen
to be worth re-processing, or whether a cached result can be reused.

Two tiers, checked in order (cheapest first):
  1. Exact-hash gate  -> catches byte-identical duplicate images (O(1))
  2. Perceptual gate  -> catches near-identical images (noise, slight
                         lighting change, recompression) using a
                         difference hash (dHash) + Hamming distance

Each cached entry also carries a confidence-derived "hit budget": the
VLM's self-reported confidence decides how many times that verdict can
be served from cache before a fresh VLM call is forced, regardless of
whether the image still visually matches. This exists because a cache
faithfully replicates whatever the VLM said, including a wrong
verdict, for as long as it's trusted — a low-confidence answer gets a
short leash, a high-confidence answer gets a longer one.

On top of that, the screen-capture loop below adds:
  - Adaptive polling interval: measures how long the VLM actually
    takes on THIS machine and derives a safe sleep time from it,
    instead of a hardcoded number.
  - Distraction speedup: polls faster while the user is flagged as
    distracted (to track whether it's real / when they get back on
    task), then relaxes back to the normal rate once on-task.
"""

import atexit
import hashlib
import io
import random
import re
import sys
import threading
import json
import time
from datetime import datetime
from collections import OrderedDict

import numpy as np
import ollama
from PIL import Image, ImageGrab


class PixelHashGate:
    """
    Cache entries now carry a "hit budget" instead of being trusted
    forever: each entry can be served up to `max_hits` times before the
    gate forces a fresh VLM call, regardless of whether the image still
    matches. This exists because a cache faithfully replicates whatever
    the VLM said — including a wrong verdict — for as long as it's
    trusted, so a low-confidence answer should get a short leash and a
    high-confidence answer can be trusted for longer. See
    confidence_to_max_hits() for how the budget is chosen.
    """

    def __init__(self, cache_size=32, phash_size=8, phash_threshold=5, default_max_hits=3):
        self.cache_size = cache_size
        self.phash_size = phash_size
        self.phash_threshold = phash_threshold
        self.default_max_hits = default_max_hits

        self._exact_cache = OrderedDict()
        self._perceptual_cache = OrderedDict()

    def _exact_hash(self, image: Image.Image, prompt: str) -> str:
        hasher = hashlib.md5()
        hasher.update(image.tobytes())
        hasher.update(prompt.encode("utf-8"))
        return hasher.hexdigest()

    def _dhash(self, image: Image.Image) -> np.ndarray:
        thumb = image.convert("L").resize((self.phash_size + 1, self.phash_size))
        pixels = np.asarray(thumb, dtype=np.int16)
        return (pixels[:, 1:] > pixels[:, :-1]).flatten()

    @staticmethod
    def _hamming(a: np.ndarray, b: np.ndarray) -> int:
        return int(np.count_nonzero(a != b))

    def check(self, image: Image.Image, prompt: str):
        exact_key = self._exact_hash(image, prompt)

        if exact_key in self._exact_cache:
            entry = self._exact_cache[exact_key]
            result, hits_used, max_hits = entry
            if hits_used < max_hits:
                entry[1] += 1
                return False, result

        new_bits = self._dhash(image)
        for entry in reversed(list(self._perceptual_cache.values())):
            dhash_bits, cached_prompt, result, hits_used, max_hits = entry
            if cached_prompt == prompt and self._hamming(new_bits, dhash_bits) <= self.phash_threshold:
                if hits_used < max_hits:
                    entry[3] += 1
                    return False, result
                break

        return True, None

    def store(self, image: Image.Image, prompt: str, result, max_hits: int = None):
        max_hits = max_hits if max_hits is not None else self.default_max_hits
        exact_key = self._exact_hash(image, prompt)
        self._exact_cache[exact_key] = [result, 0, max_hits]
        self._perceptual_cache[exact_key] = [self._dhash(image), prompt, result, 0, max_hits]

        while len(self._exact_cache) > self.cache_size:
            self._exact_cache.popitem(last=False)
        while len(self._perceptual_cache) > self.cache_size:
            self._perceptual_cache.popitem(last=False)


def call_vlm(image: Image.Image, prompt: str, model: str = "qwen3-vl:4b") -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    try:
        response = ollama.chat(
            model=model,
            options={"num_ctx": 4096, "temperature": 0},
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                    "images": [image_bytes],
                }
            ],
        )
    except Exception as exc:
        raise RuntimeError(f"Ollama call failed: {exc}") from exc

    return response["message"]["content"]


def normalize_sink(value: str) -> str:
    """Return one safe app/site token, or n/a when the model is unsure/malformed."""
    if not isinstance(value, str):
        return "n/a"

    cleaned = value.strip().strip("`'\".,;:()[]{}")
    if not cleaned:
        return "n/a"

    lowered = cleaned.lower().replace(" ", "")
    if lowered in {"n/a", "na", "unknown", "none", "unsure", "unidentified"}:
        return "n/a"

    # The prompt explicitly asks for one token. Reject multi-word spillover
    # rather than storing a misleading partial app/site name.
    if any(char.isspace() for char in cleaned) or len(cleaned) > 40:
        return "n/a"

    return cleaned


def parse_vlm_response(answer_text: str):
    """
    Tolerantly parse the VLM response.

    STATUS is the only mandatory field. Confidence, reason, and sink receive
    safe defaults when omitted, so a useful verdict is not thrown away just
    because the local model missed one formatting line.
    """
    if not isinstance(answer_text, str) or not answer_text.strip():
        return None

    status = None
    confidence = None
    reason = None
    sink = "n/a"

    for raw_line in answer_text.strip().splitlines():
        line = raw_line.strip()
        if not line:
            continue

        match = re.match(
            r"^\s*[-*]?\s*(STATUS|CONFIDENCE|REASON|SINK|APP|WEBSITE|SOURCE)\s*[:=-]\s*(.*?)\s*$",
            line,
            flags=re.IGNORECASE,
        )
        if not match:
            continue

        label = match.group(1).upper()
        value = match.group(2).strip()

        if label == "STATUS":
            normalized = re.sub(r"[\s-]+", "_", value.upper())
            if normalized in {"ON_TASK", "DISTRACTED", "AD"}:
                status = normalized

        elif label == "CONFIDENCE":
            digits = "".join(c for c in value if c.isdigit())
            if digits:
                confidence = max(0, min(100, int(digits)))

        elif label == "REASON":
            if value:
                reason = value

        elif label in {"SINK", "APP", "WEBSITE", "SOURCE"}:
            sink = normalize_sink(value)

    # Some local-model responses add prose/bullets around the labels. If the
    # STATUS label was missed, salvage a single unambiguous status token.
    if status is None:
        upper = answer_text.upper()
        candidates = []
        if re.search(r"\bON[_ -]?TASK\b", upper):
            candidates.append("ON_TASK")
        if re.search(r"\bDISTRACTED\b", upper):
            candidates.append("DISTRACTED")
        if re.search(r"\bAD\b", upper):
            candidates.append("AD")
        if len(set(candidates)) == 1:
            status = candidates[0]

    if status is None:
        return None

    if confidence is None:
        confidence = 50

    if reason is None:
        if status == "DISTRACTED":
            reason = "The visible activity does not match the user's stated focus goal."
        elif status == "AD":
            reason = "Clear YouTube advertisement UI is visible."
        else:
            reason = "The visible activity appears consistent with the user's stated focus goal."

    if status != "DISTRACTED":
        sink = "n/a"

    return {
        "status": status,
        "confidence": confidence,
        "reason": reason,
        "sink": sink,
        "raw": answer_text,
    }


def make_retry_prompt(original_prompt: str) -> str:
    return (
        original_prompt
        + "\n\nIMPORTANT: Your previous response did not contain a recognizable STATUS. "
        "Return these four labeled lines and nothing else:\n"
        "STATUS: ON_TASK or STATUS: DISTRACTED or STATUS: AD\n"
        "CONFIDENCE: <integer from 0 to 100>\n"
        "REASON: <one short, specific sentence>\n"
        "SINK: <one app/website token, or n/a>"
    )


def make_fallback_result(answer_text: str):
    """
    Last-resort handling if both attempts contain no recognizable status.

    Unknown output is neutral and never cached, so malformed model text neither
    rewards nor penalizes the user.
    """
    upper = (answer_text or "").upper()

    if re.search(r"\bSTATUS\s*[:=-]\s*DISTRACTED\b", upper):
        status = "DISTRACTED"
    elif re.search(r"\bSTATUS\s*[:=-]\s*AD\b", upper):
        status = "AD"
    elif re.search(r"\bSTATUS\s*[:=-]\s*ON[_ -]?TASK\b", upper):
        status = "ON_TASK"
    else:
        status = "NEUTRAL"

    confidence = 50
    confidence_match = re.search(r"CONFIDENCE\s*[:=-]\s*(\d{1,3})", answer_text or "", re.IGNORECASE)
    if confidence_match:
        confidence = max(0, min(100, int(confidence_match.group(1))))

    if status == "DISTRACTED":
        reason = "The focus model classified this frame as distracted but did not return a usable explanation."
    elif status == "AD":
        reason = "The focus model classified this frame as an advertisement but did not return a usable explanation."
    elif status == "ON_TASK":
        reason = "The focus model classified this frame as on task but did not return a usable explanation."
    else:
        reason = "The focus model did not return a recognizable status for this frame."

    sink_match = re.search(
        r"(?:SINK|APP|WEBSITE|SOURCE)\s*[:=-]\s*([^\r\n]+)",
        answer_text or "",
        re.IGNORECASE,
    )
    sink = normalize_sink(sink_match.group(1)) if sink_match and status == "DISTRACTED" else "n/a"

    return {
        "status": status,
        "confidence": confidence,
        "reason": reason,
        "sink": sink,
        "raw": answer_text or "",
        "invalid_for_cache": True,
    }


def analyze_frame(
    image: Image.Image,
    prompt: str,
    gate: "PixelHashGate" = None,
):
    if gate is None:
        gate = PixelHashGate()

    should_process, cached = gate.check(image, prompt)

    if not should_process:
        cached_result = parse_vlm_response(cached)
        if cached_result is not None:
            return cached_result, "CACHE HIT (HashGate)"

        print("HashGate contained malformed VLM output; bypassing cache.")
        sys.stdout.flush()

    first_answer = call_vlm(image, prompt)
    parsed = parse_vlm_response(first_answer)

    # Only retry when STATUS itself is missing/unrecognizable. Missing optional
    # formatting fields are filled safely by parse_vlm_response above.
    if parsed is None:
        print("VLM response had no recognizable status; retrying once with stricter formatting.")
        sys.stdout.flush()

        retry_answer = call_vlm(image, make_retry_prompt(prompt))
        parsed = parse_vlm_response(retry_answer)

        if parsed is None:
            print("VLM retry still had no recognizable status; using a neutral non-cached fallback.")
            sys.stdout.flush()
            return make_fallback_result(retry_answer or first_answer), "VLM CALL (Ollama, neutral fallback)"

    max_hits = confidence_to_max_hits(parsed["confidence"])
    gate.store(image, prompt, parsed["raw"], max_hits=max_hits)

    return parsed, "VLM CALL (Ollama)"


def parse_status_and_confidence(result):
    """Return STATUS and confidence for parsed-result dicts or raw strings."""
    if isinstance(result, dict):
        return result["status"], int(result["confidence"])

    parsed = parse_vlm_response(result)
    if parsed is not None:
        return parsed["status"], parsed["confidence"]

    fallback = make_fallback_result(result)
    return fallback["status"], fallback["confidence"]


def parse_reason(result) -> str:
    """Return a non-empty explanation for a parsed VLM result."""
    if isinstance(result, dict):
        return result.get("reason") or "The focus model did not return a usable explanation."

    parsed = parse_vlm_response(result)
    if parsed is not None:
        return parsed["reason"]

    return make_fallback_result(result)["reason"]


def parse_sink(result) -> str:
    """Return one normalized distracting app/site token, or n/a."""
    if isinstance(result, dict):
        return normalize_sink(result.get("sink", "n/a"))

    parsed = parse_vlm_response(result)
    if parsed is not None:
        return normalize_sink(parsed.get("sink", "n/a"))

    return normalize_sink(make_fallback_result(result).get("sink", "n/a"))


def confidence_to_max_hits(confidence: int, hits_floor: int = 2, hits_ceiling: int = 5) -> int:
    fraction = confidence / 100.0
    return round(hits_floor + fraction * (hits_ceiling - hits_floor))

import json

def run_screen_capture_loop(task):
    print("Starting live screen tracker...")
    session_start_time = time.perf_counter()

    gate = PixelHashGate(cache_size=50, phash_size=8, phash_threshold=6, default_max_hits=3)

    prompt = (
        f"The user is supposed to be doing {task}. "
        "Judge only what is visible in the screenshot. "
        "If clear YouTube ad UI is visible — such as 'Sponsored' with an advertiser/domain, "
        "'Skip' or 'Skip ad', an advertiser CTA (Subscribe, Book now, Shop, Learn more), "
        "or an ad counter such as '2 of 2' — use STATUS: AD. "
        "Otherwise judge whether the visible activity matches the user's task. "
        "Do not label normal branded or promotional content as AD unless YouTube ad UI is visible. "
        "When STATUS is DISTRACTED, identify the visible distracting website/app using exactly one token "
        "(examples: YouTube, Reddit, Discord, Spotify, GoogleDocs, VSCode). "
        "If you cannot confidently identify the website/app, use n/a. "
        "For ON_TASK or AD, use n/a.\n"
        "Respond with exactly four labeled lines:\n"
        "STATUS: ON_TASK or STATUS: DISTRACTED or STATUS: AD\n"
        "CONFIDENCE: <integer 0-100>\n"
        "REASON: <one short, specific sentence explaining what visible content supports the status>\n"
        "SINK: <one app/website token, or n/a>"
    )

    focused_count = 0
    total_count = 0
    stop_requested = threading.Event()
    pause_requested = threading.Event()

    def compute_final_score():
        if total_count:
            return round((focused_count / total_count) * 100)
        return 0

    def print_final_summary():
        print(f"FINAL_SCORE: {compute_final_score()}")
        sys.stdout.flush()

    atexit.register(print_final_summary)

    def listen_for_commands():
        try:
            for line in sys.stdin:
                command = line.strip().upper()

                if command == "STOP":
                    stop_requested.set()
                    break

                if command == "PAUSE":
                    if not pause_requested.is_set():
                        pause_requested.set()
                        print("TRACKER_PAUSED")
                        sys.stdout.flush()
                    continue

                if command == "RESUME":
                    if pause_requested.is_set():
                        pause_requested.clear()
                        print("TRACKER_RESUMED")
                        sys.stdout.flush()
                    continue
        except Exception:
            pass

    command_listener = threading.Thread(target=listen_for_commands, daemon=True)
    command_listener.start()

    RHO_MAX = 0.20
    T_MIN, T_MAX = 30, 120
    T_DISTRACTED_MIN = 15
    DISTRACTED_SPEEDUP = 3
    EMA_ALPHA = 0.3
    JITTER_FRACTION = 0.15

    ema_t_inference = None

    while not stop_requested.is_set():
        try:
            # PAUSE keeps this same Python process alive — including its score
            # counters, hash cache, prompt, and all other session state — but
            # suspends screen capture / VLM work until RESUME arrives.
            if pause_requested.is_set():
                while pause_requested.is_set() and not stop_requested.is_set():
                    time.sleep(0.1)
                continue

            frame = ImageGrab.grab()

            t0 = time.perf_counter()
            result, source = analyze_frame(frame, prompt=prompt, gate=gate)
            elapsed = time.perf_counter() - t0

            # If PAUSE arrived while Ollama was already processing a frame,
            # discard the in-flight result.
            if pause_requested.is_set() or stop_requested.is_set():
                continue

            status, confidence = parse_status_and_confidence(result)
            distracted = status == "DISTRACTED"
            ad_neutral = status == "AD"
            neutral_sample = status == "NEUTRAL"
            session_elapsed = round(time.perf_counter() - session_start_time)

            if ad_neutral:
                # Ads are neutral: do not reward or penalise the user, and do
                # not add the sample to the focus-score denominator.
                current_avg = (
                    round((focused_count / total_count) * 100)
                    if total_count
                    else 0
                )

                ad_data = {
                    "elapsed_seconds": session_elapsed,
                    "status": "AD",
                    "score": current_avg,
                    "confidence": confidence,
                    "reason": parse_reason(result),
                }
                print(f"AD_NEUTRAL: {json.dumps(ad_data, ensure_ascii=False)}")
                sys.stdout.flush()

                print(f"\n[{time.strftime('%X')}] {source}: AD (confidence: {confidence}%) — score unchanged")
                print(
                    f"STATUS: {result['status']}\n"
                    f"CONFIDENCE: {result['confidence']}\n"
                    f"REASON: {result['reason']}"
                )

            elif neutral_sample:
                current_avg = (
                    round((focused_count / total_count) * 100)
                    if total_count
                    else 0
                )
                neutral_data = {
                    "elapsed_seconds": session_elapsed,
                    "status": "NEUTRAL",
                    "score": current_avg,
                    "confidence": confidence,
                    "reason": parse_reason(result),
                }
                print(f"NEUTRAL_SAMPLE: {json.dumps(neutral_data, ensure_ascii=False)}")
                sys.stdout.flush()

            else:
                total_count += 1
                if status == "ON_TASK":
                    focused_count += 1

                current_avg = round((focused_count / total_count) * 100)

                telemetry_data = {
                    "elapsed": session_elapsed,
                    "status": status,
                    "score": current_avg
                }
                print(f"TELEMETRY: {json.dumps(telemetry_data)}")
                sys.stdout.flush()

                if distracted:
                    distraction_data = {
                        "verdict": "DISTRACTED",
                        "elapsed_seconds": session_elapsed,
                        "occurred_at": datetime.now().astimezone().isoformat(),
                        "explanation": parse_reason(result),
                        "sink": parse_sink(result),
                    }
                    print(f"DISTRACTION_LOG: {json.dumps(distraction_data, ensure_ascii=False)}")
                    sys.stdout.flush()

                    print(f"\n[{time.strftime('%X')}] {source}: DISTRACTED (confidence: {confidence}%)")
                    print(
                        f"STATUS: {result['status']}\n"
                        f"CONFIDENCE: {result['confidence']}\n"
                        f"REASON: {result['reason']}\n"
                        f"SINK: {parse_sink(result)}"
                    )

            # Adaptive polling only tracks the single normal VLM call.
            if source.startswith("VLM"):
                if ema_t_inference is None:
                    ema_t_inference = elapsed
                else:
                    ema_t_inference = EMA_ALPHA * elapsed + (1 - EMA_ALPHA) * ema_t_inference

            base_T = (ema_t_inference / RHO_MAX) if ema_t_inference else T_MAX

            if distracted:
                target_T = max(T_DISTRACTED_MIN, base_T / DISTRACTED_SPEEDUP)
                sleep_ceiling = target_T * (1 + JITTER_FRACTION)
            else:
                target_T = max(T_MIN, min(T_MAX, base_T))
                sleep_ceiling = T_MAX * (1 + JITTER_FRACTION)

            jitter = random.randint(-int(target_T * JITTER_FRACTION), int(target_T * JITTER_FRACTION))
            sleep_time = target_T + jitter
            sleep_time = max(1, min(sleep_ceiling, sleep_time))

            if distracted:
                print(f"⏳ inference {elapsed:.1f}s | interval {target_T:.1f}s | sleeping {sleep_time:.1f}s...")

            slept = 0.0
            while slept < sleep_time and not stop_requested.is_set() and not pause_requested.is_set():
                chunk = min(0.5, sleep_time - slept)
                time.sleep(chunk)
                slept += chunk


        except KeyboardInterrupt:
            print("\nStopping the screen tracker!")
            break
        except Exception as e:
            print(f"\nAn error occurred: {e}")
            print("Retrying in 10 seconds...")
            waited = 0.0
            while waited < 10 and not stop_requested.is_set() and not pause_requested.is_set():
                time.sleep(0.5)
                waited += 0.5

    print("\nStopping the screen tracker!")


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(line_buffering=True)

    goal = input().strip()
    run_screen_capture_loop(goal)