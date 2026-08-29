"""
Pixel/Hash Gate — a lightweight pre-filter in front of the VLM.

This Windows-tuned version:
  - checks the screen frequently
  - uses qwen3-vl:4b-instruct-q4_K_M first
  - downscales screenshots to a 1500px max edge for the VLM
  - automatically switches to qwen3-vl:2b-instruct-q4_K_M for the rest
    of the session if a 4B inference takes more than 50 seconds

The VLM returns:
  STATUS: ON_TASK | DISTRACTED | AD
  SINK: short app/site name or n/a
  REASON: one short sentence describing what visible content drove the verdict
"""

import atexit
import hashlib
import io
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

PRIMARY_VLM_MODEL = "qwen3-vl:4b-instruct-q4_K_M"
FALLBACK_VLM_MODEL = "qwen3-vl:2b-instruct-q4_K_M"
FOUR_B_MAX_SECONDS = 50.0
CURRENT_VLM_MODEL = PRIMARY_VLM_MODEL



class PixelHashGate:
    """
    Cache entries use a fixed hit budget so unchanged screens can reuse a
    recent verdict without repeatedly calling the VLM. Once the budget is
    exhausted, the next matching frame is classified again.
    """

    def __init__(self, cache_size=32, phash_size=8, phash_threshold=5, default_max_hits=4):
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


VLM_MAX_EDGE = 1500


def prepare_vlm_image(image: Image.Image) -> Image.Image:
    """Downscale very large screenshots before sending them to the VLM."""
    width, height = image.size
    longest_edge = max(width, height)

    if longest_edge <= VLM_MAX_EDGE:
        return image

    scale = VLM_MAX_EDGE / longest_edge
    resized = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(resized, Image.Resampling.LANCZOS)


def call_vlm(image: Image.Image, prompt: str, model: str = None):
    global CURRENT_VLM_MODEL

    chosen_model = model or CURRENT_VLM_MODEL

    buffer = io.BytesIO()
    vlm_image = prepare_vlm_image(image)
    vlm_image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    started = time.perf_counter()
    try:
        response = ollama.chat(
            model=chosen_model,
            think=False,
            keep_alive="30m",
            options={
                "num_ctx": 2048,
                "num_predict": 80,
                "temperature": 0,
            },
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

    elapsed = time.perf_counter() - started

    if chosen_model == PRIMARY_VLM_MODEL and elapsed > FOUR_B_MAX_SECONDS:
        CURRENT_VLM_MODEL = FALLBACK_VLM_MODEL
        print(
            f"MODEL_FALLBACK: {PRIMARY_VLM_MODEL} took {elapsed:.1f}s; "
            f"switching to {FALLBACK_VLM_MODEL} for the rest of this session."
        )
        sys.stdout.flush()

    return {
        "text": response["message"]["content"],
        "model": chosen_model,
        "elapsed": elapsed,
    }

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
    """Tolerantly parse STATUS, optional SINK, and optional one-sentence REASON from the VLM response."""
    if not isinstance(answer_text, str) or not answer_text.strip():
        return None

    status = None
    reason = None
    sink = "n/a"

    for raw_line in answer_text.strip().splitlines():
        line = raw_line.strip()
        if not line:
            continue

        match = re.match(
            r"^\s*[-*]?\s*(STATUS|REASON|SINK|APP|WEBSITE|SOURCE)\s*[:=-]\s*(.*?)\s*$",
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
        elif label == "REASON" and value:
            reason = value
        elif label in {"SINK", "APP", "WEBSITE", "SOURCE"}:
            sink = normalize_sink(value)

    if status is None:
        upper = answer_text.upper()
        candidates = []
        if re.search(r"\bON[_ -]?TASK\b", upper): candidates.append("ON_TASK")
        if re.search(r"\bDISTRACTED\b", upper): candidates.append("DISTRACTED")
        if re.search(r"\bAD\b", upper): candidates.append("AD")
        if len(set(candidates)) == 1:
            status = candidates[0]

    if status is None:
        return None

    if reason is None:
        if status == "DISTRACTED":
            reason = "Visible content appears unrelated to the stated task, but the model did not provide a more specific explanation."
        elif status == "AD":
            reason = "Visible YouTube ad markers indicate an advertisement."
        else:
            reason = "Visible content appears relevant to the stated task, but the model did not provide a more specific explanation."

    if status != "DISTRACTED": sink = "n/a"
    return {"status": status, "reason": reason, "sink": sink, "raw": answer_text}


def make_retry_prompt(original_prompt: str) -> str:
    # Keep the retry tiny too: the screenshot itself consumes most of the VLM context.
    return original_prompt + "\nReply with only the three requested lines. STATUS must be ON_TASK, DISTRACTED, or AD."


def make_fallback_result(answer_text: str):
    """Return a neutral, non-cached result when STATUS cannot be recovered."""
    upper = (answer_text or "").upper()
    if re.search(r"\bSTATUS\s*[:=-]\s*DISTRACTED\b", upper):
        status = "DISTRACTED"
    elif re.search(r"\bSTATUS\s*[:=-]\s*AD\b", upper):
        status = "AD"
    elif re.search(r"\bSTATUS\s*[:=-]\s*ON[_ -]?TASK\b", upper):
        status = "ON_TASK"
    else:
        status = "NEUTRAL"

    if status == "DISTRACTED":
        reason = "The focus model classified this frame as distracted but did not return a usable explanation."
    elif status == "AD":
        reason = "The focus model classified this frame as an advertisement but did not return a usable explanation."
    elif status == "ON_TASK":
        reason = "The focus model classified this frame as on task but did not return a usable explanation."
    else:
        reason = "The focus model did not return a recognizable status for this frame."

    sink_match = re.search(r"(?:SINK|APP|WEBSITE|SOURCE)\s*[:=-]\s*([^\r\n]+)", answer_text or "", re.IGNORECASE)
    sink = normalize_sink(sink_match.group(1)) if sink_match and status == "DISTRACTED" else "n/a"
    return {"status": status, "reason": reason, "sink": sink, "raw": answer_text or "", "invalid_for_cache": True}


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
            cached_result["vlm_calls"] = 0
            cached_result["vlm_inference_total_seconds"] = 0.0
            return cached_result, "CACHE HIT (HashGate)"

        print("HashGate contained malformed VLM output; bypassing cache.")
        sys.stdout.flush()

    first_call = call_vlm(image, prompt)
    first_answer = first_call["text"]
    parsed = parse_vlm_response(first_answer)

    # Only retry when STATUS itself is missing/unrecognizable. Missing optional
    # formatting fields are filled safely by parse_vlm_response above.
    if parsed is None:
        print("VLM response had no recognizable status; retrying once with stricter formatting.")
        sys.stdout.flush()

        retry_call = call_vlm(image, make_retry_prompt(prompt), model=first_call["model"])
        retry_answer = retry_call["text"]
        parsed = parse_vlm_response(retry_answer)

        if parsed is None:
            print("VLM retry still had no recognizable status; using a neutral non-cached fallback.")
            sys.stdout.flush()
            fallback = make_fallback_result(retry_answer or first_answer)
            fallback["model"] = retry_call["model"]
            fallback["inference_seconds"] = retry_call["elapsed"]
            fallback["vlm_calls"] = 2
            fallback["vlm_inference_total_seconds"] = first_call["elapsed"] + retry_call["elapsed"]
            return fallback, "VLM CALL (Ollama, neutral fallback)"

        parsed["model"] = retry_call["model"]
        parsed["inference_seconds"] = retry_call["elapsed"]
        parsed["vlm_calls"] = 2
        parsed["vlm_inference_total_seconds"] = first_call["elapsed"] + retry_call["elapsed"]
        gate.store(image, prompt, parsed["raw"])
        return parsed, "VLM CALL (Ollama)"

    parsed["model"] = first_call["model"]
    parsed["inference_seconds"] = first_call["elapsed"]
    parsed["vlm_calls"] = 1
    parsed["vlm_inference_total_seconds"] = first_call["elapsed"]
    gate.store(image, prompt, parsed["raw"])

    return parsed, "VLM CALL (Ollama)"

def parse_status(result) -> str:
    """Return STATUS for parsed-result dicts or raw strings."""
    if isinstance(result, dict): return result["status"]
    parsed = parse_vlm_response(result)
    if parsed is not None: return parsed["status"]
    return make_fallback_result(result)["status"]


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



def run_screen_capture_loop(task):
    print("Starting live screen tracker...")
    print(f"PRIMARY_MODEL: {PRIMARY_VLM_MODEL}")
    sys.stdout.flush()
    session_start_time = time.perf_counter()

    gate = PixelHashGate(cache_size=50, phash_size=8, phash_threshold=6, default_max_hits=4)

    prompt = (
        f"Task: {task}\n\n"
        "Classify the screenshot. Ignore the Zone overlay.\n\n"
        "ON_TASK = matches or could reasonably support the task.\n"
        "DISTRACTED = clearly unrelated.\n"
        "AD = clear YouTube ad.\n\n"
        "LLM chats, Google Search, email, browsers, etc. are not distractions by default. "
        "Judge the visible content. If relevance is unclear but plausible, use ON_TASK.\n\n"
        "For YouTube, AD markers include Sponsored, advertiser/domain, Skip/Skip ad, "
        "ad countdown, or advertiser CTA.\n\n"
        "SINK = the distracting app/site, only when DISTRACTED. "
        "Use a short name like YouTube, Reddit, ChatGPT, Gmail, Discord. "
        "If unclear, use n/a. ON_TASK or AD = n/a.\n\n"
        "REASON = one short sentence stating what visible content led to the verdict. "
        "Be specific and mention the visible app, page, document, code editor, video topic, or ad marker.\n\n"
        "Reply exactly:\n"
        "STATUS: ON_TASK|DISTRACTED|AD\n"
        "SINK: name|n/a\n"
        "REASON: one sentence"
    )

    focused_count = 0
    total_count = 0

    check_count = 0
    vlm_call_count = 0
    cache_hit_count = 0
    vlm_inference_total_seconds = 0.0

    stop_requested = threading.Event()
    pause_requested = threading.Event()

    def compute_final_score():
        if total_count:
            return round((focused_count / total_count) * 100)
        return 0

    def print_final_summary():
        avg_vlm_time = (
            vlm_inference_total_seconds / vlm_call_count
            if vlm_call_count
            else 0.0
        )

        print(f"FINAL_SCORE: {compute_final_score()}")
        print(f"CHECKS: {check_count}")
        print(f"VLM_CALLS: {vlm_call_count}")
        print(f"CACHE_HITS: {cache_hit_count}")
        print(f"AVG_VLM_TIME: {avg_vlm_time:.1f}s")
        print(f"MODEL: {CURRENT_VLM_MODEL}")
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

    NORMAL_CHECK_INTERVAL = 5.0
    DISTRACTED_CHECK_INTERVAL = 3.0

    while not stop_requested.is_set():
        try:
            loop_started = time.perf_counter()

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

            check_count += 1

            if source.startswith("CACHE HIT"):
                cache_hit_count += 1

            if isinstance(result, dict):
                vlm_call_count += int(result.get("vlm_calls", 0) or 0)
                vlm_inference_total_seconds += float(
                    result.get("vlm_inference_total_seconds", 0.0) or 0.0
                )

            # If PAUSE arrived while Ollama was already processing a frame,
            # discard the in-flight result.
            if pause_requested.is_set() or stop_requested.is_set():
                continue

            status = parse_status(result)
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
                    "reason": parse_reason(result),
                }
                print(f"AD_NEUTRAL: {json.dumps(ad_data, ensure_ascii=False)}")
                sys.stdout.flush()

                print(f"\n[{time.strftime('%X')}] {source}: AD — score unchanged")
                print(
                    f"STATUS: {result['status']}\n"
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

                if status == "ON_TASK":
                    print(f"\n[{time.strftime('%X')}] {source}: ON_TASK")
                    print(
                        f"STATUS: {result['status']}\n"
                        f"REASON: {result['reason']}\n"
                        f"SINK: n/a"
                    )
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

                    print(f"\n[{time.strftime('%X')}] {source}: DISTRACTED")
                    print(
                        f"STATUS: {result['status']}\n"
                        f"REASON: {result['reason']}\n"
                        f"SINK: {parse_sink(result)}"
                    )

            # Target cadence from loop start: slow inference gets no extra delay.
            processing_time = time.perf_counter() - loop_started
            target_interval = DISTRACTED_CHECK_INTERVAL if distracted else NORMAL_CHECK_INTERVAL
            sleep_time = max(0.0, target_interval - processing_time)

            model_used = result.get("model", "unknown") if isinstance(result, dict) else "unknown"
            inference_seconds = result.get("inference_seconds") if isinstance(result, dict) else None
            inference_part = (
                f" inference={inference_seconds:.1f}s"
                if isinstance(inference_seconds, (int, float))
                else ""
            )
            print(
                f"CHECK_TIMING: source={source} model={model_used}"
                f"{inference_part} processing={processing_time:.1f}s "
                f"next_sleep={sleep_time:.1f}s "
                f"checks={check_count} vlm_calls={vlm_call_count} cache_hits={cache_hit_count}"
            )
            sys.stdout.flush()

            slept = 0.0
            while slept < sleep_time and not stop_requested.is_set() and not pause_requested.is_set():
                chunk = min(0.25, sleep_time - slept)
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