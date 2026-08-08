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
    return f"""<!doctype html>
<html lang="id" style="color-scheme:dark;supported-color-schemes:dark;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>{title}</title>
  <style>
    :root {{ color-scheme: dark; supported-color-schemes: dark; }}
    body, .email-page {{ background-color: #050507 !important; }}
    .email-card {{ background-color: #101014 !important; }}
    .email-content, .email-content p, .email-content td {{ color: #d4d4d8; }}
    .email-content a {{ color: #fb7185; }}
    @media only screen and (max-width: 640px) {{
      .email-page {{ padding: 20px 10px !important; }}
      .email-card {{ width: 100% !important; border-radius: 14px !important; }}
      .email-header {{ padding: 26px 24px 0 !important; }}
      .email-content {{ padding: 22px 24px 28px !important; }}
      .email-footer {{ padding: 18px 24px !important; }}
    }}
    [data-ogsc] .email-page {{ background-color: #050507 !important; }}
    [data-ogsc] .email-card {{ background-color: #101014 !important; }}
  </style>
</head>
<body bgcolor="#050507" style="margin:0;padding:0;background-color:#050507;font-family:Arial,Helvetica,sans-serif;color:#f4f4f5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{title} · TripleSide Studio</div>
<table class="email-page" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#050507" style="width:100%;background-color:#050507;padding:40px 16px;">
  <tr>
    <td align="center" valign="top">
      <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table class="email-card" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#101014" style="width:100%;max-width:600px;background-color:#101014;border:1px solid #2a2a32;border-radius:18px;overflow:hidden;">
        <tr>
          <td height="4" bgcolor="#e11d48" style="height:4px;line-height:4px;background-color:#e11d48;font-size:0;">&nbsp;</td>
        </tr>
        <tr>
          <td class="email-header" style="padding:32px 40px 0 40px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="36" height="36" align="center" valign="middle" bgcolor="#e11d48" style="width:36px;height:36px;background-color:#e11d48;border-radius:8px;color:#ffffff;font-size:12px;font-weight:800;letter-spacing:-0.5px;">3S</td>
                <td style="padding-left:12px;color:#ffffff;font-size:21px;font-weight:800;letter-spacing:-0.6px;">TripleSide<span style="color:#fb2c55;">.</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="email-content" style="padding:26px 40px 34px 40px;color:#d4d4d8;line-height:1.65;font-size:15px;">
            {body_html}
          </td>
        </tr>
        <tr>
          <td class="email-footer" bgcolor="#0b0b0e" style="padding:20px 40px;border-top:1px solid #27272f;background-color:#0b0b0e;color:#7f7f8a;font-size:12px;line-height:1.6;">
            <div style="color:#a1a1aa;font-weight:700;margin-bottom:2px;">TripleSide Studio</div>
            <div>Sound that moves from three sides.</div>
            <div style="margin-top:8px;"><a href="https://triplesidestudio.com" style="color:#fb7185;text-decoration:none;">triplesidestudio.com</a></div>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
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


def registration_otp_html(code: str, expires_minutes: int = 10) -> str:
    body = f"""
    <h1 style="font-size:26px;color:#fff;margin:0 0 8px 0;">Verifikasi email Anda</h1>
    <p style="color:#a1a1aa;margin:0 0 24px 0;">Gunakan kode berikut untuk menyelesaikan registrasi akun TripleSide.</p>
    <div style="background:#151518;border:1px solid #e11d48;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
      <div style="color:#a1a1aa;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Kode OTP Registrasi</div>
      <div style="color:#fff;font-family:monospace;font-size:34px;font-weight:800;letter-spacing:10px;">{code}</div>
    </div>
    <p style="color:#a1a1aa;margin:0;">Kode berlaku selama {expires_minutes} menit dan hanya dapat digunakan satu kali.</p>
    <p style="color:#71717a;font-size:12px;margin-top:20px;">Jika Anda tidak melakukan registrasi, abaikan email ini.</p>
    """
    return _shell("Kode OTP Registrasi", body)


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


# ==========================================================
# EMAIL CAMPAIGN
# ==========================================================

def campaign_email_html(title: str, message: str) -> str:
    """
    HTML template untuk Email Campaign Admin.
    message boleh berisi HTML.
    """

    body = f"""
    <h1 style="font-size:28px;color:#fff;margin:0 0 18px 0;">
        {title}
    </h1>

    <div style="
        color:#d4d4d8;
        font-size:15px;
        line-height:1.8;
        margin-bottom:30px;
    ">
        {message}
    </div>

    <table cellspacing="0" cellpadding="0">
        <tr>
            <td style="background:#e11d48;border-radius:999px;">
                <a href="https://triplesidestudio.com"
                   style="
                       display:inline-block;
                       padding:12px 28px;
                       color:#ffffff;
                       text-decoration:none;
                       font-weight:700;
                       font-size:14px;
                   ">
                    Visit TripleSide Studio
                </a>
            </td>
        </tr>
    </table>

    <p style="
        margin-top:30px;
        color:#71717a;
        font-size:12px;
    ">
        Anda menerima email ini karena terdaftar sebagai customer
        TripleSide Studio.
    </p>
    """

    return _shell(title, body)


async def send_campaign_email(
    recipients: list[str],
    subject: str,
    message: str,
):
    """
    Broadcast Email.

    recipients = list email customer
    message = HTML
    """

    success = 0
    failed = 0

    html = campaign_email_html(subject, message)

    for email in recipients:

        ok = await send_email(
            to=email,
            subject=subject,
            html=html,
        )

        if ok:
            success += 1
        else:
            failed += 1

    logger.info(
        f"Campaign Finished : success={success} failed={failed}"
    )

    return {
        "success": success,
        "failed": failed,
        "total": len(recipients),
    }
