"""Email service using Resend SDK (sync SDK wrapped via asyncio.to_thread)."""
import os
import asyncio
import logging
import resend

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


async def send_email(to: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY or not to:
        logger.warning(f"Email skipped (no API key or recipient): to={to}")
        return False
    try:
        params = {"from": SENDER_EMAIL, "to": [to], "subject": subject, "html": html}
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"Email sent to {to}: {result.get('id')}")
        return True
    except Exception as e:
        logger.error(f"Resend send failed to {to}: {e}")
        return False


def _shell(title: str, body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0a0c;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#0f0f12;border:1px solid #1f1f22;border-radius:16px;overflow:hidden;max-width:600px;">
      <tr><td style="padding:32px 40px 0 40px;">
        <table cellspacing="0" cellpadding="0"><tr>
          <td style="background:#e11d48;width:32px;height:32px;text-align:center;color:#fff;font-weight:bold;border-radius:6px;font-size:12px;">3S</td>
          <td style="padding-left:10px;font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">TripleSide<span style="color:#e11d48;">.</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 40px 32px 40px;color:#e4e4e7;line-height:1.6;font-size:15px;">
        {body_html}
      </td></tr>
      <tr><td style="padding:20px 40px;border-top:1px solid #1f1f22;color:#71717a;font-size:12px;">
        TripleSide Studio · Sound that moves from three sides.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def purchase_confirmation_html(customer_name: str, product_name: str, amount: float, currency: str, dashboard_url: str, license_key: str = "", max_activations: int = 0) -> str:
    body = f"""
    <h1 style="font-size:26px;color:#fff;margin:0 0 8px 0;">Pembayaran berhasil ✓</h1>
    <p style="color:#a1a1aa;margin:0 0 24px 0;">Halo {customer_name}, terima kasih sudah membeli di TripleSide Studio.</p>
    <table cellspacing="0" cellpadding="0" width="100%" style="background:#050505;border:1px solid #1f1f22;border-radius:12px;padding:20px;margin-bottom:24px;">
      <tr><td style="color:#71717a;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;padding-bottom:4px;">Produk</td></tr>
      <tr><td style="color:#fff;font-weight:600;font-size:17px;padding-bottom:12px;">{product_name}</td></tr>
      <tr><td style="color:#71717a;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;padding-bottom:4px;">Total Bayar</td></tr>
      <tr><td style="color:#e11d48;font-weight:700;font-size:22px;">{"Rp"} {"{:,.0f}".format(amount).replace(",", ".")}</td></tr>
    </table>
    {f'<div style="background:#151518;border:1px solid #e11d48;border-radius:12px;padding:20px;margin-bottom:24px;"><div style="color:#a1a1aa;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">Serial Number RSA</div><div style="color:#fff;font-family:monospace;font-size:17px;font-weight:700;word-break:break-all;">{license_key}</div><div style="color:#a1a1aa;font-size:12px;margin-top:8px;">Dapat diaktifkan pada maksimal {max_activations} komputer.</div></div>' if license_key else ''}
    <p style="color:#a1a1aa;margin:0 0 24px 0;">File digital Anda sekarang tersedia di dashboard. Klik tombol di bawah untuk men-download.</p>
    <table cellspacing="0" cellpadding="0"><tr><td style="background:#e11d48;border-radius:999px;">
      <a href="{dashboard_url}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">Buka Dashboard</a>
    </td></tr></table>
    """
    return _shell("Pembayaran Berhasil", body)


def password_reset_html(customer_name: str, reset_url: str) -> str:
    body = f"""
    <h1 style="font-size:26px;color:#fff;margin:0 0 8px 0;">Reset password</h1>
    <p style="color:#a1a1aa;margin:0 0 24px 0;">Halo {customer_name}, kami menerima permintaan untuk reset password akun TripleSide Anda.</p>
    <p style="color:#a1a1aa;margin:0 0 24px 0;">Klik tombol di bawah untuk membuat password baru. Link ini berlaku 1 jam.</p>
    <table cellspacing="0" cellpadding="0"><tr><td style="background:#e11d48;border-radius:999px;">
      <a href="{reset_url}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">Reset Password</a>
    </td></tr></table>
    <p style="color:#71717a;font-size:12px;margin-top:24px;">Jika Anda tidak meminta reset, abaikan email ini. Password tidak akan berubah.</p>
    """
    return _shell("Reset Password", body)


def trial_license_html(customer_name: str, product_name: str, license_key: str, trial_days: int, expires_at: str) -> str:
    body = f"""
    <h1 style="font-size:26px;color:#fff;margin:0 0 8px 0;">Trial {trial_days} hari siap</h1>
    <p style="color:#a1a1aa;margin:0 0 24px 0;">Halo {customer_name}, trial untuk <strong style="color:#fff;">{product_name}</strong> sudah dibuat.</p>
    <div style="background:#151518;border:1px solid #e11d48;border-radius:12px;padding:20px;margin-bottom:24px;">
      <div style="color:#a1a1aa;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">Trial Serial Number</div>
      <div style="color:#fff;font-family:monospace;font-size:17px;font-weight:700;word-break:break-all;">{license_key}</div>
      <div style="color:#a1a1aa;font-size:12px;margin-top:8px;">Berlaku sampai {expires_at[:10]} dan hanya untuk 1 komputer.</div>
    </div>
    <p style="color:#a1a1aa;">Masukkan serial ini pada jendela aktivasi plugin. Masa trial diverifikasi oleh server.</p>
    """
    return _shell("Trial License", body)
