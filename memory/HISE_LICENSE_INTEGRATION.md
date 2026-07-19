# HISE License Integration — TripleSide Studio (Online + Hardware Lock)

Script ini dibuat mengikuti **script referensi Anda yang sudah terbukti jalan** (fungsi `showControl`, `getChildFile`, `writeString`, `loadAsString`, `isFile`, `deleteFile`, `getParentDirectory`, `createDirectory`, named inline callback `setControlCallback`, `component.setValue(0)`), **ditambah** `Server.setBaseURL` + `Server.callWithPOST` (Anda konfirmasi berjalan) dan `FileSystem.getSystemId()` (untuk kunci 1 komputer).

## Prinsip
- Serial divalidasi **online** ke server TripleSide → semua license key yang terjual otomatis valid, tanpa edit script.
- **1 plugin = 1 komputer**: server mengikat `hardware_id` (dari `FileSystem.getSystemId()`) saat aktivasi pertama. Komputer lain pakai serial sama → ditolak (HTTP 409).
- Setelah aktif, bukti disimpan lokal (`license.txt` + `machine.txt`) → plugin **tetap terbuka walau offline**.
- Server menerima **form-encoded** (default `Server.callWithPOST`), jadi TIDAK perlu `setHttpHeader`.

## Catatan teknis penting (agar tidak error)
- Callback `Server.callWithPOST` di script ini dibuat **anonymous** (`function(status, response){...}`) dan **self-contained** — hanya memakai variabel global (`const var` / `reg`) dan panggilan API langsung. Ini menghindari 2 gotcha HISE: (1) `local` var tidak ter-capture ke callback, (2) inline function tidak dipanggil dari dalam callback.
- `pendingSerial` disimpan di `reg` global supaya bisa dibaca di dalam callback.

---

## Script (paste di script processor `onInit`)

```javascript
Content.makeFrontInterface(600, 400);

//====================================================
// LICENSE MANAGER — Online + Hardware Lock (1 PC)
//====================================================

// ---------------- CONFIG ----------------
const var BASE_URL = "https://triplesidestudio.com"; // produksi
// const var BASE_URL = "https://tripleside-studio.preview.emergentagent.com"; // testing

// ---------------- COMPONENTS ----------------
const var pnlActivation    = Content.getComponent("pnlActivation");
const var pnlMain          = Content.getComponent("pnlMain");
const var txtSerial        = Content.getComponent("txtSerial");
const var btnActivate      = Content.getComponent("btnActivate");
const var lblLicenseStatus = Content.getComponent("lblLicenseStatus");

// ---------------- LICENSE FILES ----------------
const var licenseFile = FileSystem.getFolder(FileSystem.AppData)
    .getChildFile("TripleSide Studio")
    .getChildFile("Latihan Piano")
    .getChildFile("license.txt");

const var machineFile = FileSystem.getFolder(FileSystem.AppData)
    .getChildFile("TripleSide Studio")
    .getChildFile("Latihan Piano")
    .getChildFile("machine.txt");

// ---------------- GLOBAL (untuk async callback) ----------------
reg pendingSerial = "";

// ---------------- SERVER ----------------
Server.setBaseURL(BASE_URL);

// ---------------- CLEAN SERIAL ----------------
inline function cleanSerial(text)
{
    local s = text.toString();
    s = s.replace(" ", "");
    s = s.toUpperCase();
    return s;
}

// ---------------- ACTIVATE (online) ----------------
inline function activateLicense(serialInput)
{
    pendingSerial = cleanSerial(serialInput);

    local payload = {
        "license_key": pendingSerial,
        "hardware_id": FileSystem.getSystemId(),
        "machine_name": "HISE"
    };

    lblLicenseStatus.set("text", "Mengecek serial...");

    Server.callWithPOST("api/license/activate", payload, function(status, response)
    {
        if(status == 200)
        {
            // Simpan bukti aktivasi (serial + machine id). Hanya API langsung.
            local folder = licenseFile.getParentDirectory();
            if(!folder.isDirectory())
                folder.createDirectory("");

            licenseFile.writeString(pendingSerial);
            machineFile.writeString(FileSystem.getSystemId());

            pnlActivation.showControl(false);
            pnlMain.showControl(true);
            txtSerial.set("text", "");
            lblLicenseStatus.set("text", "License Active");
            Console.print("License OK");
        }
        else if(status == 409)
            lblLicenseStatus.set("text", "Serial sudah dipakai di komputer lain.");
        else if(status == 404)
            lblLicenseStatus.set("text", "Serial Number Tidak Valid");
        else if(status == 403)
            lblLicenseStatus.set("text", "Lisensi dibatalkan. Hubungi support.");
        else
            lblLicenseStatus.set("text", "Gagal terhubung ke server. Cek internet.");
    });
}

// ---------------- BUTTON CALLBACK ----------------
inline function onbtnActivateControl(component, value)
{
    if(!value)
        return;

    local serial = txtSerial.get("text");
    activateLicense(serial);
    component.setValue(0);
}
btnActivate.setControlCallback(onbtnActivateControl);

// ---------------- STARTUP ----------------
if(licenseFile.isFile()
   && machineFile.isFile()
   && machineFile.loadAsString() == FileSystem.getSystemId())
{
    // Lisensi lokal cocok dengan komputer ini -> buka (jalan walau offline)
    Console.print("License Loaded");
    pnlActivation.showControl(false);
    pnlMain.showControl(true);
    lblLicenseStatus.set("text", "License Active");

    // Re-check online untuk menangkap revoke oleh admin.
    // Hanya kunci kalau server SECARA EKSPLISIT bilang tidak valid (status 200 + valid=false).
    // Kalau offline / server tak terjangkau -> tetap terbuka.
    pendingSerial = licenseFile.loadAsString();

    Server.callWithPOST("api/license/verify",
        { "license_key": pendingSerial, "hardware_id": FileSystem.getSystemId() },
        function(status, response)
        {
            if(status == 200 && response.valid == false)
            {
                if(licenseFile.isFile()) licenseFile.deleteFile();
                if(machineFile.isFile()) machineFile.deleteFile();
                pnlMain.showControl(false);
                pnlActivation.showControl(true);
                lblLicenseStatus.set("text", "Lisensi tidak berlaku. Aktivasi ulang.");
            }
        });
}
else
{
    Console.print("Activation Required");
    pnlMain.showControl(false);
    pnlActivation.showControl(true);
    lblLicenseStatus.set("text", "Masukkan Serial Number");
}

// ---------------- MIDI callbacks (biarkan seperti biasa) ----------------
function onNoteOn()  {}
function onNoteOff() {}
function onController() {}
function onTimer()   {}
function onControl(number, value) {}
```

---

## Cara test (sebelum produksi)
1. Ganti `BASE_URL` ke URL testing (baris komentar).
2. Admin Panel → buat produk **gratis** dengan `is_free = true` DAN `requires_license = true`.
3. Login sbg customer → klaim produk → ambil license key dari dashboard `/dashboard`.
4. Buka plugin di HISE → ketik serial → klik Activate.
   - Sukses → panel utama muncul, status "License Active".
   - Serial salah → "Serial Number Tidak Valid".
   - Serial dipakai komputer lain → "Serial sudah dipakai di komputer lain."
5. Tutup & buka lagi (matikan internet) → tetap terbuka (bukti tersimpan lokal).
6. Copy folder `license.txt`+`machine.txt` ke komputer lain → `machine.txt` tidak cocok `getSystemId()` → plugin minta aktivasi lagi (ditolak server karena hardware beda).

## Operasional
- **Ganti komputer:** Admin → Licenses → **Reset** lisensi tsb → customer aktivasi ulang di PC baru.
- **Batalkan:** Admin → Licenses → **Revoke** → saat startup online plugin otomatis terkunci.

## Endpoint yang dipakai (sudah aktif di server)
- `POST /api/license/activate` — body form: `license_key`, `hardware_id`, `machine_name`. Sukses `200`; `404` key salah; `409` mesin lain; `403` revoked.
- `POST /api/license/verify` — body form: `license_key`, `hardware_id`. Selalu `200` + `{ "valid": true/false, "reason": ... }`.
