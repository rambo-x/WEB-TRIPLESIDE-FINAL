"""Simple in-memory IP-based rate limiter (good for MVP; for production use Redis)."""
import time
import threading
from collections import deque
from fastapi import Request, HTTPException


class RateLimiter:
    def __init__(self, max_calls: int, window_seconds: int):
        self.max_calls = max_calls
        self.window = window_seconds
        self._buckets: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _client_key(self, request: Request) -> str:
        # Prefer X-Forwarded-For (we sit behind ingress), fallback to client host
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def check(self, request: Request) -> None:
        key = self._client_key(request)
        now = time.time()
        cutoff = now - self.window
        with self._lock:
            q = self._buckets.setdefault(key, deque())
            # Drop expired
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_calls:
                retry_in = int(q[0] + self.window - now) + 1
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many requests. Try again in {retry_in} seconds.",
                    headers={"Retry-After": str(retry_in)},
                )
            q.append(now)
            # Opportunistic cleanup if dict grows large
            if len(self._buckets) > 5000:
                stale = [k for k, v in self._buckets.items() if not v or v[-1] < cutoff]
                for k in stale[:1000]:
                    self._buckets.pop(k, None)


# Forgot-password limiter: 3 requests per IP per 15 minutes
forgot_password_limiter = RateLimiter(max_calls=3, window_seconds=15 * 60)

# Customer login limiter: 10 per IP per 5 minutes (anti credential-stuffing)
login_limiter = RateLimiter(max_calls=10, window_seconds=5 * 60)
