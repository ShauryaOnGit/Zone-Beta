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
            options={"num_ctx": 4102},
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


def analyze_frame(
    image: Image.Image,
    prompt: str,
    gate: "PixelHashGate" = None,
):
    if gate is None:
        gate = PixelHashGate()

    should_process, cached = gate.check(image, prompt)
    if not should_process:
        return cached, "CACHE HIT (HashGate)"

    result = call_vlm(image, prompt)
    distracted, confidence = parse_status_and_confidence(result)
    max_hits = confidence_to_max_hits(confidence)
    gate.store(image, prompt, result, max_hits=max_hits)

    return result, "VLM CALL (Ollama)"


def parse_status_and_confidence(answer_text: str):
    lines = answer_text.strip().splitlines()
    status_line = lines[0].upper() if lines else ""
    distracted = "DISTRACTED" in status_line

    confidence = 50
    for line in lines:
        if line.upper().startswith("CONFIDENCE:"):
            digits = "".join(c for c in line.split(":", 1)[1] if c.isdigit())
            if digits:
                confidence = max(0, min(100, int(digits)))
            break

    return distracted, confidence


def parse_reason(answer_text: str) -> str:
    """Return the VLM's REASON text exactly as emitted after the REASON: label."""
    for line in answer_text.splitlines():
        if line.upper().startswith("REASON:"):
            return line.split(":", 1)[1].strip()
    return ""


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
        "Look at the screenshot and respond in this exact format:\n"
        "STATUS: ON_TASK or STATUS: DISTRACTED\n"
        "CONFIDENCE: <integer 0-100, how sure you are of the STATUS above>\n"
        "REASON: <one short sentence>"
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
            answer, source = analyze_frame(frame, prompt=prompt, gate=gate)
            elapsed = time.perf_counter() - t0

            # If PAUSE arrived while Ollama was already processing a frame,
            # discard that in-flight result rather than counting break-screen
            # activity as focus telemetry.
            if pause_requested.is_set() or stop_requested.is_set():
                continue

            distracted, confidence = parse_status_and_confidence(answer)

            total_count += 1
            if not distracted:
                focused_count += 1

            current_avg = round((focused_count / total_count) * 100)
            session_elapsed = round(time.perf_counter() - session_start_time)

            # Standardized telemetry output (without confidence)
            telemetry_data = {
                "elapsed": session_elapsed,
                "status": "DISTRACTED" if distracted else "ON_TASK",
                "score": current_avg
            }
            print(f"TELEMETRY: {json.dumps(telemetry_data)}")
            sys.stdout.flush()

            if distracted:
                distraction_data = {
                    "verdict": "DISTRACTED",
                    "elapsed_seconds": session_elapsed,
                    "occurred_at": datetime.now().astimezone().isoformat(),
                    "explanation": parse_reason(answer),
                }
                print(f"DISTRACTION_LOG: {json.dumps(distraction_data, ensure_ascii=False)}")
                sys.stdout.flush()

                print(f"\n[{time.strftime('%X')}] {source}: DISTRACTED (confidence: {confidence}%)")
                print(answer)

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