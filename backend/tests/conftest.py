"""Shared pytest fixtures.

Backend now has IP-based rate limiting (10/5min login, 3/15min forgot-password).
Tests would trip these limits because they all originate from the same egress IP.
We inject a unique X-Forwarded-For header per pytest session so all regression
tests appear to come from a fresh IP and bypass the limiter.
Dedicated rate-limit tests in test_iteration4.py explicitly override XFF.
"""
import os
import uuid
import requests

_original_request = requests.Session.request


def _fresh_ip() -> str:
    n = uuid.uuid4().int
    return f"10.{n % 250}.{(n >> 8) % 250}.{(n >> 16) % 250 + 1}"


def _patched_request(self, method, url, **kwargs):
    headers = kwargs.pop("headers", None) or {}
    # Don't override if a test explicitly sets X-Forwarded-For (rate-limit tests do)
    if not any(k.lower() == "x-forwarded-for" for k in headers):
        headers["X-Forwarded-For"] = _fresh_ip()
    kwargs["headers"] = headers
    return _original_request(self, method, url, **kwargs)


requests.Session.request = _patched_request

print("[conftest] Injecting unique X-Forwarded-For per request to bypass rate limiter in regression tests")
