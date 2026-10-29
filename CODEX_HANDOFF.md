# Codex Handoff — TripleSide Studio VST Maker

Updated: 2026-10-29 01:56 UTC

Dokumen ini adalah ringkasan operasional. Bagian paling atas selalu menjadi sumber kebenaran terbaru; jangan menganggap catatan deployment lama sebagai pekerjaan yang masih tertunda.

## CHECKPOINT AKTIF — sinkronisasi Classic Legend + Smooth Reverb + Smooth Chord Tail selesai

- Source fitur di-commit selektif dan dipush ke `main` pada `5e1b139b4bbbc5b1d666d2ec43ae75df46498754` (`Sync Legend and smooth reverb native DSP`). Dirty worktree lain milik pengguna tetap tidak distage, direset, atau dibersihkan.
- Classic Legend native memakai empat wrapper proxy browser yang disetujui (`LegendPreamp`, `LegendCompressor`, `LegendEq`, `LegendTape`), bukan dedicated Legend v16. Room/Spring/Plate/Hall native memakai Smooth Reverb FDN delapan jalur, sedangkan `shimmer` memakai algoritma tunggal Smooth Chord Tail v25 dengan `rise`/`tone`.
- Parity langsung browser/native ditambah untuk masing-masing Room, Spring, Plate, dan Hall. Verifikasi final hijau: seluruh native `170 passed`, backend build-spec/worker `64 passed`, frontend Legend/Reverb/export `71 passed`, parity langsung `9 passed`, generator worklet deterministik, Python `py_compile`, `git diff --check`, dan optimized frontend build.
- CI source commit tersebut sukses pada kedua platform:
  - Windows run `40802696321`, artifact `12866508792` `tripleside-windows-vst3-installer`, digest `sha256:eea5cced45dae5f871dd002bcfe537252414ffbb4f2befaa0bd3f6b6b6ffd174`.
  - macOS Universal run `40802699340`, artifact `12866917410` `tripleside-macos-vst3-universal`, digest `sha256:1ae32f198f2015b5a218384940bca570bf6dbaa2088d0d6317156a15bad82cca`.
- Worker Windows dioverlay hanya pada `DspModules.h`, `DspModules.cpp`, `NativeInstrument.cpp`, dan `compile_manifest.py`. Backup rollback: `C:\TripleSideWorker\backups\classic-legend-smooth-reverb-chord-tail-before-20261029T015356Z`. SHA-256 remote/lokal cocok berurutan: `fdb297bd...e1293`, `e77c20e7...e48cb`, `58064fe1...6f6d`, `d8d9391b...730a3`. Task `Running`, tepat satu worker PID `904`, jobs `0`.
- Backend production memakai `classic-legend-smooth-reverb-chord-tail-v1`; PM2 PID `120298`, status `online`, unstable restart `0`. API lokal/publik membalas `status: ok`, log restart tidak memiliki error baru, dan konfigurasi Nginx valid.
- Frontend guard Legend sudah dibuka dan badge menyatakan browser/native sinkron. Production memakai `main.87f1f231.js` sha256 `480c561b2050189a836e5a6a92b31ded85663111be62287acd0cc2c3b42e4113`, CSS `main.7bc127ef.css` sha256 `ce9b8c207ba8a9af4fcfd7c1782ff516f60f90ba5e21c505586a5716048a19ed`, serta `vst-dsp-worklet-v25.js` sha256 `d42487beb713ebfdc589b86a74669abe95e045964e4ddaed2b89057449fe9e30`; seluruh hash publik/lokal cocok. Rollback frontend: `/home/triplesidestudio/tripleside/frontend/build-backup-20261029T0156Z-before-full-legend-reverb-sync`.
- Smoke production bersih: homepage/worklet HTTP `200`, root React terisi, AudioContext `running`, worklet `ready`, oscillator chord finite dan audible (`RMS 0.03039`, peak `0.07222`), console/page/request error `0`.
- Audit akhir: active all/customer/Windows builds `0`, workflow customer macOS aktif `0`, worker jobs `0`. Tidak ada job atau artifact pelanggan yang dibuat, di-retry, dibatalkan, diklaim, dihapus, atau dimutasi; artifact yang dibuat hanya dua artifact CI internal di atas.

Seluruh sinkronisasi yang diminta selesai. Langkah berikutnya tunggal: pengguna dapat membuat export Legend/Reverb baru melalui alur normal dan mengaudisinya di DAW; jangan membuat build pelanggan atas inisiatif agen.

## CHECKPOINT AKTIF — Smooth Chord Tail v25 live, menunggu audisi

- Klarifikasi final pengguna: gunakan karakter dan ruangan Smooth Reverb yang sebelumnya sudah disetujui sebagai patokan, lalu kembangkan menjadi shimmer dengan tail panjang yang terasa membentuk chord mengikuti di belakang. Target bukan choir kering, bukan Classic Shimmer terang, dan bukan FDN/resonansi “gentong”.
- Eksperimen v24 yang mengutamakan direct choir return dibatalkan sebelum deployment. v25 memakai tuning Hall Smooth Reverb v20 secara persis untuk diffusion, size, damping/low control, root injection, feedback, late taps, dan wet return.
- Root–fifth–octave dibentuk dengan dual-grain panjang `110 ms`, detune sangat kecil, filter harmonik gelap, dan slow-send envelope `180–450 ms`. Pitch layer hanya diinjeksikan ke tank reverb; tidak ada direct pitch/shimmer return, sehingga harmoni muncul dari tail di belakang sumber.
- Tes fokus frontend `56 passed`: Reverb v20 identik, fifth/octave hadir, onset harmonik terlambat, tail panjang/finite/padat/stereo, mono/low-send/extremes aman, rise responsif, legacy Shimmer bermigrasi, dan tidak ada branch Classic empat jalur. Optimized build sukses.
- Production memakai `main.5191966d.js` (`sha256:b2278ca8bff0af06e74319236890024b076beb9b67ca01b2561b17992db961ee`), CSS `main.7bc127ef.css` (`sha256:ce9b8c207ba8a9af4fcfd7c1782ff516f60f90ba5e21c505586a5716048a19ed`), dan `vst-dsp-worklet-v25.js` (`sha256:d42487beb713ebfdc589b86a74669abe95e045964e4ddaed2b89057449fe9e30`). Hash publik/lokal cocok; production smoke HTTP `200`, AudioContext `running`, worklet `ready`, oscillator chord audible/finite, console/page/core error `0`.
- Rollback frontend v23: `/home/triplesidestudio/tripleside/frontend/build-backup-20261029T0117Z-before-smooth-chord-tail-v25`. Native/compiler/backend/worker/commit/push/export guard tidak disentuh.
- Langkah berikutnya tunggal: pengguna mengaudisi apakah ruangnya kembali seperti Smooth Reverb yang disukai dan apakah chord benar-benar tumbuh di tail panjang di belakang. Iterasikan browser saja sampai disetujui; jangan mulai sinkronisasi native.

## CHECKPOINT SEBELUMNYA — Unison Choir v23 ditolak karena terdengar seperti reverb gentong

- Pengguna melaporkan v22 masih terdengar seperti Classic Shimmer. Penyebabnya terkonfirmasi: walau branch Classic sudah dihapus, v22 masih menjadikan transposisi fifth+octave dan direct harmonic return sebagai pusat suara.
- v23 menghapus pitch-shift fifth/octave sepenuhnya. Choir sekarang mengikuti nada/chord asli melalui empat unison delay voices dengan modulasi sangat lambat, stereo cross-blend, formant hangat, slow-send envelope, diffuser dan FDN delapan jalur. Tidak ada branch Classic, grain octave/fifth, atau state pitch lama.
- Tes fokus frontend tetap `56 passed`; kontrak baru membuktikan root/chord tone lebih dominan daripada octave, choir lebih hadir daripada v21, rise responsif, migrasi legacy, Reverb v20 identik, serta finite/stereo/mono/low-send/extremes aman. Optimized build sukses.
- Production memakai `main.29777734.js` (`sha256:b2de56dcad38630e09cf81a0c56b19b186ec039a718da55f5d87433373953155`), CSS `main.7bc127ef.css` (`sha256:ce9b8c207ba8a9af4fcfd7c1782ff516f60f90ba5e21c505586a5716048a19ed`), dan `vst-dsp-worklet-v23.js` (`sha256:eb7bb2b10b80e14c89f0af21b104578f9c20c07244cce5466407a1c4a2260ae9`). Hash publik/lokal cocok; production smoke HTTP `200`, AudioContext `running`, worklet `ready`, chord audible/finite, console/page/core error `0`.
- Rollback frontend v22: `/home/triplesidestudio/tripleside/frontend/build-backup-20261029T0041Z-before-unison-choir-v23`. Native/compiler/backend/worker/commit/push/export guard tidak disentuh.
- Langkah berikutnya tunggal: pengguna mengaudisi apakah v23 sudah benar-benar terasa seperti choir lembut dan tidak lagi seperti Classic Shimmer. Iterasikan browser saja bila perlu; jangan mulai sinkronisasi native sebelum disetujui.

## CHECKPOINT SEBELUMNYA — Chord Bloom Choir v22 ditolak karena masih seperti Classic Shimmer

- Classic Shimmer sudah dihapus dari UI dan runtime browser. Module type tersimpan tetap `shimmer`, tetapi semua project lama maupun baru kini otomatis memakai algoritma tunggal `Chord Bloom`; parameter legacy `mode` dibuang saat normalisasi dan nama lama `Shimmer Reverb` dimigrasikan menjadi `Chord Bloom`.
- Choir v22 lebih hadir daripada v21: attack `Bloom rise` kini `90–320 ms`, harmonic envelope lebih responsif, fifth+octave dibentuk dengan formant blend hangat, slow ensemble/decorrelation halus, harmonic gain lebih kuat, serta direct choir return kecil. Root/dry, FDN delapan jalur, low-send, limiter/headroom, mono, dan tail cleanup tetap dipertahankan.
- Reverb v20 dibandingkan deterministik terhadap worklet v21 dan tetap identik. Dua suite fokus hijau: `56 passed`, termasuk migrasi Shimmer, bukti choir lebih kuat daripada v21, rise responsif, fifth/octave, major/minor, finite/stereo/mono, low-send, parameter ekstrem, dan update realtime. Optimized build sukses.
- Production memakai `main.1feadb85.js` (`sha256:c25f524ec125cd49578a03aaf50921cccd5f674910de378297c0d41dd80e67aa`), CSS `main.7bc127ef.css` (`sha256:ce9b8c207ba8a9af4fcfd7c1782ff516f60f90ba5e21c505586a5716048a19ed`), dan `vst-dsp-worklet-v22.js` (`sha256:fb4b2422b6db19067222ed9e7f8f0cbea4b105d32db2f951fdf5cf135109500c`). Hash publik/lokal worklet cocok; production smoke: HTTP `200`, AudioContext `running`, worklet `ready`, oscillator chord audible/finite, console/page/core error `0`.
- Rollback frontend: `/home/triplesidestudio/tripleside/frontend/build-backup-20261029T0029Z-before-chord-choir-v22`. Native/compiler/backend/worker/commit/push/export guard tidak disentuh.
- Langkah berikutnya tunggal: pengguna mengaudisi seberapa terasa choir, kelembutan/kehangatan, attack/rise, pergantian chord, tone, dan Mix. Iterasikan browser saja bila masih perlu; jangan mulai sinkronisasi native sampai disetujui.

## PERMINTAAN CHORD BLOOM CHOIR — selesai 2026-10-29

Hasil audisi pengguna terhadap Chord Bloom v21: lapisan chord masih kurang terasa. Klarifikasi pengguna: iterasi berikutnya justru harus dibuat **lebih condong ke karakter choir saja**—choir yang lembut, hangat, dan mengikuti di belakang—bukan diarahkan menjauh dari choir atau menjadi organ yang terlalu tegas. Pengguna juga meminta Classic Shimmer dihapus; keputusan ini menggantikan syarat kompatibilitas Classic pada handoff sebelumnya.

### Perubahan produk yang diminta

- Hapus pilihan `Classic Shimmer` dari UI dan jadikan `Chord Bloom` satu-satunya algoritma untuk module type tersimpan `shimmer`. Pertahankan type `shimmer` agar project/save binding tidak rusak, tetapi project lama yang memuat Shimmer kini sengaja memakai Chord Bloom.
- Buang branch audio Classic Shimmer empat jalur dari runtime browser setelah tes/migrasi diperbarui. Jangan lagi menampilkan atau menjanjikan kompatibilitas suara Classic.
- Nama/label modul boleh tetap `Shimmer Reverb` untuk kompatibilitas data, tetapi copy yang terlihat sebaiknya menekankan `Chord Bloom`; jangan tampilkan selector mode satu opsi.
- Native/compiler/backend/worker/export guard tetap tidak disentuh. Iterasikan dan deploy browser saja, lalu berhenti untuk audisi baru.

### Arah koreksi suara

- Buat karakter wet return lebih jelas seperti lapisan choir lembut: hangat, halus, menyatu, sedikit vokal/formant-like, dan muncul perlahan di belakang sumber tanpa suku kata atau artikulasi manusia yang kentara.
- Fifth dan octave tetap menjadi fondasi harmoni universal, tetapi blend keduanya menjadi satu hamparan choir; jangan membuat masing-masing voice terdengar sebagai pitch shifter atau organ yang terpisah. Fifth tetap lebih rendah daripada octave.
- Tambahkan decorrelation/ensemble yang lambat dan sangat halus bila diperlukan untuk memberi kesan beberapa suara choir, sambil menjaga pusat nada, mono compatibility, dan bass tetap stabil. Hindari shimmer kristal, detune berlebihan, serta chorus yang mabuk atau berombak.
- Pertahankan slow bloom di belakang transient, tetapi pendekkan atau bentuk ulang attack bila envelope saat ini membuat lapisan nyaris tidak muncul. Kontrol `Bloom rise` harus memiliki rentang yang benar-benar terdengar.
- Pertahankan root/dry di depan, ruang Smooth Reverb v20 yang padat dan gelap, harmonic high-pass/low-pass, headroom, limiter, mono compatibility, dan tail yang dapat membersihkan diri saat chord berganti.
- Audit gain staging antara root injection dan harmonic/choir injection. Naikkan kehadiran choir secara aman sebelum menaikkan feedback; jangan membuat runaway atau nada lama menumpuk.
- Gunakan stimulus single note, chord mayor, chord minor, dan pergantian dua chord. Ukur energy pada root/fifth/octave serta onset early-vs-late agar perbaikan bukan sekadar volume wet lebih besar.

### Kontrak implementasi berikutnya

1. Kerjakan hanya `frontend/src/lib/vstMakerDspRack.js`, `vstDspProcessor.js`, worklet cache-bust baru, dan tes fokus terkait. Pertahankan Reverb v20 sample-for-sample.
2. Ganti tes kompatibilitas Classic dengan tes migrasi bahwa Shimmer lama masuk Chord Bloom; tambah bukti fifth/octave hadir tetapi menyatu, rise responsif, chord transition bersih, finite/stereo/mono/low-send/parameter extremes tetap aman.
3. Ikuti mode hemat kuota: dua suite frontend fokus, `git diff --check`, optimized staging build hanya pada final gate, lalu deploy frontend dengan backup rollback dan verifikasi hash/HTTP/audio smoke singkat.
4. Setelah live, berhenti dan minta pengguna mengaudisi: seberapa terasa lapisan choir, kelembutan dan kehangatannya, attack/rise, pergantian chord, tone, dan Mix.

Langkah berikutnya tunggal: implementasikan koreksi browser di atas. Jangan memulai sinkronisasi native Classic Legend/Smooth Reverb/Chord Bloom sebelum versi baru ini disetujui pengguna.

## CHECKPOINT AKTIF — Chord Bloom browser v21 live, menunggu audisi

- Module tersimpan tetap `shimmer`. Pilihan baru `Classic Shimmer` (default project lama) dan `Chord Bloom` sudah live; Classic dibandingkan deterministik dengan worklet v20 dan identik. Reverb v20 tidak diubah.
- Chord Bloom memakai diffuser empat tahap + FDN delapan jalur terpisah, fifth dan octave dual-grain, slow-send envelope, harmonic high/low-pass, detune stereo kecil, limiter/headroom, serta kontrol `Bloom intensity`, `Bloom rise`, dan `Bloom tone`.
- Tes fokus frontend hijau: `56 passed`; mencakup onset lambat, fifth/octave, major/minor chord, tail finite/padat/stereo, mono, low-send, parameter ekstrem, dan pergantian mode realtime. Optimized build sukses.
- Production memakai `main.fd1054df.js` (`sha256:90562b6c86d99d7875270fd8b94fb1be154b859142c6abd72808fd4324948eac`) dan `vst-dsp-worklet-v21.js` (`sha256:74c55fa9e7bb509c6d5e6d6db0ec4153a94422ee4c4c83e9caa9c4f1692986ac`); homepage/worklet HTTP `200` dan bundle publik benar. Rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T2136Z-before-chord-bloom-v21`.
- Native/compiler/backend/worker/commit/push/export guard tidak disentuh. Langkah berikutnya tunggal: pengguna mengaudisi kelembutan attack, tone gelap, kejelasan chord, pergantian chord/tail, dan posisi Mix; iterasikan browser saja sampai disetujui.

## HANDOFF AKTIF — buat Chord Bloom frontend sebelum sinkronisasi native

Permintaan terbaru pengguna mengubah urutan kerja: sebelum menjalankan sinkronisasi Classic Legend + Smooth Reverb v20 yang sudah direncanakan, pengguna ingin Shimmer baru yang terdengar seperti **nada chord organ sangat lembut yang mengikuti di belakang**, dengan karakter, warna, density, dan dimensi ruang yang sama seperti Smooth Reverb yang baru disetujui. Pengguna meminta fitur ini dimasukkan ke handoff **sebelum sinkronisasi tadi**. Karena itu, jangan mulai native/compiler/backend revision/worker/commit/push dari bagian sinkronisasi di bawah sampai Chord Bloom browser selesai, dideploy, diaudisi, dan disetujui pengguna.

### Keputusan produk dan batas fase browser

- Pertahankan module type tersimpan `shimmer` agar project lama kompatibel, lalu tambahkan parameter pilihan `mode` dengan minimal dua opsi: `Classic Shimmer` dan `Chord Bloom`. Default project lama wajib tetap Classic; jangan mengubah suara Shimmer lama secara diam-diam.
- Classic Shimmer harus tetap memakai algoritma empat jalur octave+fifth yang sekarang, sample-for-sample bila memungkinkan. Chord Bloom adalah branch baru.
- Chord Bloom memakai diffuser dan FDN delapan jalur Smooth Reverb v20 sebagai ruang dasarnya—khususnya density, damping, low-frequency control, slow modulation, stereo late taps, dan karakter wet return yang sudah disukai pengguna. Jangan menumpuk pitch voice ke tank Shimmer empat jalur lama yang lebih kasar.
- Fase pertama browser-only. Jangan membuka export Legend, jangan mengubah native, compiler, backend allowlist/revision, worker, atau builder macOS. Setelah browser Chord Bloom disetujui, baru sinkronkan Classic Legend + Smooth Reverb v20 + Chord Bloom sekaligus memakai bagian tahap kedua di bawah.

### Karakter audio Chord Bloom

- Suara utama harus tetap jelas di depan; lapisan harmonik muncul perlahan di belakang seperti organ/choir pad, bukan shimmer kristal tajam.
- Gunakan base/root reverb dari input asli ditambah pitch voices universal yang aman terhadap mayor/minor: fifth `2^(7/12)` dan octave `2`. Hindari major/minor third tetap pada versi awal karena dapat berbenturan dengan chord sumber. Jangan mengklaim chord detection atau harmonic intelligence; versi awal mentransposisikan keseluruhan audio secara musikal.
- Pitch voice memakai dual overlapping grains/window halus, phase offset stereo berbeda, dan detune/decorrelation sangat kecil agar tidak terdengar seperti satu pitch shifter statis. Tidak boleh ada klik saat grain berganti.
- Beri slow-send envelope berbasis level input: target attack kira-kira `180–450 ms` dan release `650–1400 ms`, sehingga bloom tertinggal dari transient dan mengikuti sustain. Envelope hanya mengatur send harmonik; jangan menghaluskan waveform langsung hingga kehilangan pitch.
- High-pass harmonic send sekitar `140–220 Hz` dan low-pass lembut sekitar `3.2–5.5 kHz`; fifth lebih rendah daripada octave. Tujuannya warna organ gelap/lembut, bukan desis metalik.
- Feedback harmonik harus konservatif dan dibatasi sebelum masuk tank; pergantian chord harus dapat membersihkan diri tanpa runaway, ringing, atau penumpukan nada lama. Pertahankan limiter halus serta headroom wet seperti Reverb v20.
- Stereo harus lebar tetapi pusat/root tetap stabil. Lapisan fifth/octave boleh didekorrelasi; jangan membuat bass melebar atau phase cancellation ekstrem saat mono.
- Gunakan kontrol Shimmer yang sudah ada (`mix`, `size`, `decay`, `damping`, `pre_delay`, `shimmer`) sejauh mungkin. `shimmer` menjadi intensitas Bloom pada mode baru. Tambahkan kontrol baru hanya bila benar-benar diperlukan; kandidat minimal adalah `rise` untuk kecepatan muncul dan `tone` untuk kegelapan. Hindari panel parameter yang berlebihan sebelum audisi pertama.

### Implementasi dan kontrak tes frontend

1. Source utama: `frontend/src/lib/vstMakerDspRack.js`, `vstMakerDspPreview.js` bila perlu, `vstDspProcessor.js`, tes fokusnya, serta UI rack yang sudah merender parameter dari definition. Naikkan cache-busted worklet dari v20 ke versi baru; pertahankan file worklet lama sebagai rollback.
2. Reuse struktur FDN delapan jalur secara aman tanpa allocation/resize dalam render loop. State Classic dan Chord Bloom harus terisolasi atau di-reset hanya saat topology baru dibuat; update parameter/mode realtime tidak boleh crash, menghasilkan non-finite sample, atau mereset seluruh rack secara tidak sengaja.
3. Tambahkan tes deterministik untuk: Classic Shimmer tidak berubah; Bloom onset lebih lambat daripada dry/base reverb; fifth dan octave benar-benar hadir; tail padat/finite/stereo; mono compatibility masuk akal; low send terkendali; parameter extremes tidak runaway; perubahan mode/parameter realtime aman; empty rack dan Reverb v20 tidak berubah.
4. Gunakan stimulus single note dan chord mayor/minor untuk memastikan branch universal tetap musikal. Ukur RMS/peak/crest/occupancy serta band energy, bukan hanya memeriksa output berbeda dari input.
5. Ikuti mode hemat kuota: satu atau dua suite frontend fokus, `git diff --check`, lalu optimized staging build dan browser smoke hanya pada final gate. Smoke harus memakai audio nyata/oscillator-chord, AudioContext `running`, worklet baru `ready`, output audible, dan tidak ada console/page/core request error.
6. Deploy frontend melalui staging + swap dengan backup rollback, cocokkan hash publik/lokal, lalu berhenti. Minta pengguna mengaudisi terutama: kelembutan attack, kegelapan tone, kejelasan chord, tail saat chord berganti, dan posisi Mix.
7. Jangan menambahkan Chord Bloom ke handoff native final sebagai algoritma yang disetujui sampai pengguna benar-benar menyukainya. Bila pengguna meminta koreksi, iterasikan browser saja.

### Gerbang sebelum tahap kedua

- Chord Bloom browser harus dinyatakan bagus oleh pengguna.
- Classic Legend tetap chain Classic yang dipilih; dedicated Legend v16 tetap ditolak.
- Room/Spring/Plate/Hall v20 dan Classic Shimmer tidak boleh mengalami regresi.
- Setelah persetujuan Chord Bloom, perbarui handoff tahap kedua dengan parameter/konstanta final dan baseline hash baru, lalu sinkronkan seluruh paket sekaligus.

Prompt lanjutan yang disarankan:

> Baca hanya handoff aktif paling atas `tripleside/CODEX_HANDOFF.md`. Tahan sinkronisasi native sebelumnya. Implementasikan dulu mode browser `Chord Bloom` pada module Shimmer: organ/choir pad sangat lembut yang muncul di belakang, memakai ruang/density Smooth Reverb v20, sementara Classic Shimmer dan seluruh Reverb v20 tidak berubah. Deploy frontend untuk audisi, lalu berhenti; jangan sentuh native/compiler/backend revision/worker/commit/push atau membuka export sebelum saya menyetujui Chord Bloom.

## HANDOFF TAHAP KEDUA — sinkronisasi penuh Classic Legend + Smooth Reverb v20 disetujui, tetapi ditahan sampai Chord Bloom final

Pengguna sudah mengaudisi frontend production dan menyatakan seluruh Reverb sudah **“bagus sekali”**. Pengguna kemudian meminta: **“buatkan handoff untuk sinkronkan seluruh perubahan termasuk legend tadi”**. Persetujuan sinkronisasi native Windows/macOS tetap berlaku, tetapi permintaan Chord Bloom terbaru menahannya sampai algoritma browser baru disetujui. Pekerjaan sinkronisasi belum dimulai pada sesi ini; tidak ada native/compiler/backend revision/worker/commit/push yang diubah.

### Baseline browser yang wajib dianggap final

- Production saat handoff memakai `main.76b66c18.js` (`sha256:a746b8b1eed97b40961b4d53fbdcfebeceebca7e2db183622174d7da007243f7`), CSS `main.7bc127ef.css` (`sha256:ce9b8c207ba8a9af4fcfd7c1782ff516f60f90ba5e21c505586a5716048a19ed`), dan `vst-dsp-worklet-v20.js` (`sha256:a2fe2275768faf76a5de8df1b80104af674ed1c51a3683869bc20372a0b825fd`). Browser smoke production bersih dan keempat mode Reverb audible.
- Source browser otoritatif adalah `frontend/src/lib/vstMakerDspPreview.js` untuk Classic Legend dan `frontend/src/lib/vstDspProcessor.js` untuk Smooth Reverb. Port rumus dan urutan operasi dari source tersebut; jangan menebak ulang dari deskripsi ini bila ada perbedaan.
- Classic Legend yang dipilih pengguna adalah proxy chain `soft_clip → linked_compressor → tone_shaper → soft_clip`, bukan dedicated Legend DSP v16. Dedicated `legend_*` processor yang masih ada di `vstDspProcessor.js` adalah eksperimen rollback dan **jangan** dijadikan target native. Empat pilihan model tetap audible melalui perubahan parameter, tetapi bukan empat topology/circuit hardware 1:1.
- Smooth Reverb v20: Room, Spring, Plate, dan Hall memakai diffuser empat tahap + modulated FDN delapan jalur dengan tuning terpisah. Hall v20 identik sample-for-sample dengan Hall v19 yang disukai pengguna; wet return Hall sudah dinaikkan sekitar `+2.9 dB`. `Shimmer` sengaja tetap memakai algoritma empat jalur lama dan tidak boleh berubah dalam sinkronisasi ini.

### Kontrak Classic Legend yang harus sama di browser dan native

Pertahankan module ID, bypass, module mix, urutan rack, parameter sumber, binding kontrol, save/reload, dan gain-reduction meter. Cara native yang direkomendasikan adalah menambah empat `RackModuleType` wrapper (`LegendPreamp`, `LegendCompressor`, `LegendEq`, `LegendTape`) yang menyimpan parameter Legend asli lalu menggerakkan processor native stabil yang sudah ada. Dengan wrapper, perubahan `model` atau parameter lain dapat menghitung ulang beberapa target proxy sekaligus; jangan hanya mengubah tipe di compile manifest karena binding realtime `model`/`color`/`air` dan parameter Legend lainnya akan rusak.

Gunakan mapping persis berikut, semuanya clamp `0..1`:

1. `legend_preamp` menjalankan `SoftClip`:
   - `drive = 0.035 + 0.24 * sourceDrive * (0.9 + 0.2 * model)`
   - `character = 0.72 * color + 0.28 * model`
   - output memakai fungsi level-match yang sama dengan browser: `saturationDrive = 1 + drive*14`; `smallSignalGain = saturationDrive / tanh(saturationDrive)`; `compensationDb = 20*log10(smallSignalGain)`; `mappedOutput = clamp(sourceOutput - compensationDb/24)`.
   - `high_pass` tetap diterima/disimpan untuk kompatibilitas UI, tetapi Classic browser tidak memakainya dalam audio.
2. `legend_compressor` menjalankan `LinkedCompressor` detailed mode:
   - `compress = amount`
   - `threshold = 0.76 - 0.46*amount - 0.08*model`
   - `ratio = 0.18 + 0.50*amount + 0.12*model`
   - `attack = sourceAttack + 0.12*(model - 0.5)`
   - `release = sourceRelease + 0.08*model`
   - `makeup = sourceMakeup` dengan default factory `0`; gain-reduction meter harus membaca underlying compressor untuk module ID Legend.
3. `legend_eq` menjalankan `ToneShaper` three-band mode:
   - `tone = 0.45 + 0.10*model`
   - `low = sourceLow`, `mid = sourceMid`
   - `high = 0.72*sourceHigh + 0.28*sourceAir`
   - High dan Air pada Classic memang digabung; jangan port dedicated v16 yang memisahkannya.
4. `legend_tape` menjalankan `SoftClip`:
   - `drive = 0.025 + 0.19*sourceDrive + 0.04*age + 0.02*(1-speed)`
   - `character = 0.42 + 0.32*model + 0.16*age`
   - output memakai fungsi level-match yang sama seperti Preamp, dengan source output/default Tape yang tersimpan.
   - `wow_flutter` dan `noise` tetap diterima/disimpan, tetapi Classic browser tidak memakainya dalam audio.

Perbarui sekurangnya `native-vst3/Source/DspModules.h/.cpp`, `NativeInstrument.cpp`, dan `native-vst3/tools/compile_manifest.py`; tambahkan empat tipe dan seluruh parameter Legend ke allowlist backend `NATIVE_DSP_MODULE_TYPES`/`NATIVE_DSP_MODULE_PARAMETERS`. Compiler harus meneruskan tipe dan parameter Legend asli agar wrapper dapat melakukan mapping realtime. Jangan menyamarkan module sebagai proxy di manifest.

### Kontrak Smooth Reverb v20 yang harus dipindahkan sample-by-sample

- Perluas `SpatialReverb` native dengan delapan tank buffer berdurasi `0.18 s`, cursor/damping/low state per jalur, dua array kerja delapan elemen, empat diffuser stereo `0.014 s`, delay diffuser `3.1/4.7/6.9/9.7 ms`, serta phase modulasi kedua berawal `1.37`.
- Untuk `shimmerMode_ == false`, port branch Reverb delapan jalur dari `frontend/src/lib/vstDspProcessor.js`: keempat delay profile 8-tap, mode-specific diffusion/size/high-cut/low-control/modulation/feedback/injection/output arrays, normalized 8-point Hadamard matrix `1/sqrt(8)`, Spring dispersion, limiter `tanh(input*1.08)/1.08`, stereo late taps, dan wet gains. Pertahankan float/double dan operation order sedekat mungkin agar fixture parity stabil.
- Untuk `shimmerMode_ == true`, pertahankan branch native empat jalur yang sekarang. Jangan mengubah pitch voices, choir filter, shimmer feedback, atau output gain.
- Tidak boleh ada allocation, resize, lock, file I/O, atau logging dalam `processFrame`. Semua buffer dibuat di `prepare`, seluruh state dibersihkan di `reset`, dan perubahan parameter/model tidak boleh mereset tail.
- Tes browser yang menjadi kontrak: Room/Spring/Plate/Hall finite, tail occupancy padat, stereo tidak kolaps; Hall v19→v20 maximum difference `0`. Tambahkan fixture parity native untuk impulse stereo pada keempat mode, pengujian decay/damping/size, perubahan parameter realtime, reset, sample rate minimal `44.1/48/96 kHz`, dan bukti Shimmer tidak berubah.

### Guard, UI, test, dan urutan deployment

1. Mulai dengan audit read-only: active customer/all builds `0`, worker Windows jobs `0`, dan tidak ada workflow customer macOS aktif. Jangan membuat build/job/artifact pelanggan untuk smoke.
2. Implementasikan native/compiler/backend terlebih dahulu dengan tes. Tambahkan kontrak pada `native-vst3/tests/test_dsp_modules.py`, `test_compile_manifest.py`, `test_runtime_source_contract.py`, dan parity fixture/harness; tambahkan tes backend build-spec untuk empat tipe/parameter Legend. Pertahankan fixture lain.
3. Frontend baru boleh membuka export setelah native parity hijau: hapus dua early-return `hasUnsyncedLegendHardware`, keluarkan flag tersebut dari `disabled/title`, dan ganti badge `Browser preview · native menyusul` menjadi copy yang menyatakan browser/native sinkron. Tambahkan tes UI agar guard tidak kembali.
4. Jalankan suite fokus per batch; pada final gate jalankan seluruh `native-vst3/tests` sekali, backend VST fokus, frontend Legend/Reverb/export-guard fokus, Python compile untuk file Python yang berubah, generator/parity fixture, optimized frontend build bila frontend berubah, lalu `git diff --check`.
5. Worktree sangat dirty/untracked. Jangan reset/clean dan jangan stage file di luar scope. Commit/push selektif hanya file Classic Legend, Smooth Reverb, guard UI, compiler/native/backend tests, dan handoff. macOS builder membutuhkan commit pada branch `main`, jadi commit/push adalah bagian sinkronisasi final setelah seluruh tes lokal hijau.
6. Jalankan CI smoke Windows dan macOS Universal pada commit final. Wajib memeriksa plugin memuat full Legend channel + tiap Reverb mode, automation/model update, bypass/mix, meter compressor, state restore, serta Shimmer regression.
7. Setelah CI sukses dan seluruh queue tetap `0`, backup lalu overlay hanya source native terkait ke worker Windows, cocokkan SHA-256, restart task secara terkontrol, pastikan satu worker aktual `Running` dan jobs `0`. Jangan overlay frontend/backend atau file unrelated ke worker.
8. Naikkan `VST_BUILD_PIPELINE_REVISION` dari `open-ring-vector-glow-v1` ke nama baru yang jelas, misalnya `classic-legend-smooth-reverb-v1`, restart backend hanya setelah queue `0`, lalu verifikasi PM2/API/Nginx dan revision publik/lokal. Ini mencegah reuse artifact lama dengan DSP berbeda.
9. Deploy frontend guard/badge terakhir melalui staging build dan swap dengan rollback. Cocokkan hash publik/lokal dan lakukan browser production smoke. Jangan mengubah harga, entitlement, kuota, job/artifact pelanggan, atau data customer.
10. Hasil akhir harus mencatat commit, CI run/artifact Windows dan macOS, backup worker, hash overlay, pipeline revision, frontend hashes, status queue/worker/backend, serta menegaskan tidak ada customer artifact yang dibuat.

### Gerbang kegagalan

- Jangan membuka export Legend bila salah satu platform belum benar-benar memakai wrapper Classic yang sama.
- Jangan menggunakan dedicated Legend v16 meski source-nya tersedia; itu sudah ditolak melalui audisi pengguna.
- Jangan menganggap “empat model” sebagai empat emulasi hardware nyata; native harus mengikuti mapping Classic yang disukai, tanpa klaim 1:1.
- Bila parity Hall berubah, rollback perubahan native Reverb dan bandingkan operation order terhadap browser v20 sebelum melanjutkan.
- Bila commit/push atau akses worker/platform tidak tersedia, pertahankan guard export dan berhenti dengan laporan jelas; jangan menghasilkan artifact yang diketahui tidak sinkron.

Prompt lanjutan yang disarankan:

> Baca hanya handoff aktif paling atas `tripleside/CODEX_HANDOFF.md`, lalu sinkronkan penuh Classic Legend yang dipilih pengguna dan Smooth Reverb v20 ke native Windows/macOS. Ikuti rumus/gerbang secara persis, pertahankan Shimmer dan Hall, jangan port dedicated Legend v16, jangan reset/clean dirty worktree, dan jangan membuka export sampai parity serta CI kedua platform hijau. Selesaikan worker, pipeline revision, frontend guard, dan smoke final tanpa membuat job/artifact pelanggan.

## CHECKPOINT AKTIF — seluruh mode Reverb halus v20 live; Classic Legend tetap dipertahankan

- Seluruh mode `Reverb` kini memakai diffuser empat tahap dan modulated feedback-delay network delapan jalur dengan tuning terpisah. Room dibuat pendek/natural dan tidak boxy; Spring memakai dispersion lembut agar musikal tanpa boing berlebihan; Plate lebih terang, padat, dan halus; Hall v19 yang sudah disukai pengguna dipertahankan byte-for-byte. `Shimmer` tetap tidak diubah.
- `frontend/src/lib/vstMakerDspPreview.js` juga sudah dikembalikan dan dikunci ke mapping Classic yang dipilih pengguna: `soft_clip → linked_compressor → tone_shaper → soft_clip`. Source dedicated Legend masih tersedia tetapi tidak dipakai oleh preview Classic. Build berikutnya tidak akan tanpa sengaja mengembalikan dedicated v16.
- AudioWorklet aktif adalah `vst-dsp-worklet-v20.js`. Tes DSP fokus `32 passed`, termasuk kontrak density/finite/stereo untuk Room, Spring, Plate, dan Hall; perbandingan deterministik memastikan output Hall v19 dan v20 memiliki maximum difference `0`. `git diff --check` bersih dan optimized build sukses.
- Production memakai `main.76b66c18.js` (`sha256:a746b8b1eed97b40961b4d53fbdcfebeceebca7e2db183622174d7da007243f7`), CSS `main.7bc127ef.css` (`sha256:ce9b8c207ba8a9af4fcfd7c1782ff516f60f90ba5e21c505586a5716048a19ed`), dan worklet v20 (`sha256:a2fe2275768faf76a5de8df1b80104af674ed1c51a3683869bc20372a0b825fd`). Hash publik/lokal cocok.
- Browser smoke production: HTTP `200`, root terisi, bundle benar, AudioContext `running`, keempat mode mengirim `ready` dan menghasilkan output audible, serta console/page error `0`. Active customer/all builds sebelum swap `0`.
- Rollback tepat sebelum seluruh mode halus: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T2110Z-before-smooth-reverbs-v20`; Hall v19 tetap terdapat di sana. Backup sebelumnya tetap aman.
- Compiler/native, worker Windows, builder macOS, backend revision, commit/push, export guard, job/artifact, dan data pelanggan tidak disentuh. Worktree tetap sangat dirty; jangan reset/clean.
- Langkah berikutnya tunggal: pengguna mengaudisi Room, Spring, dan Plate di browser. Jangan sinkronkan native sebelum hasil audisi dan izin eksplisit baru.

Prompt lanjutan yang disarankan:

> Baca checkpoint paling atas `tripleside/CODEX_HANDOFF.md` dan ikuti MODE HEMAT KUOTA. Seluruh mode Reverb halus v20 live, Hall v19 dipertahankan identik, dan Classic Legend tetap aktif. Mulai dari hasil audisi Room/Spring/Plate saya; jangan sentuh native/compiler/worker/backend revision/commit/push tanpa izin eksplisit.

## CHECKPOINT SEBELUMNYA — Legend Hardware v1 deployed; peningkatan akurasi ditunda untuk sesi berikutnya

- Pengguna menyatakan Legend Hardware v1 sudah cukup baik untuk tahap sekarang, lalu menanyakan apakah suara dapat diperbagus dan dibuat lebih akurat. Jawabannya: bisa, tetapi implementasi berikutnya belum dimulai karena pengguna meminta dibuatkan handoff untuk dilanjutkan nanti.
- Batas teknis v1 yang harus dipahami sebelum melanjutkan: `legend_preamp` dan `legend_tape` masih dipetakan ke processor `soft_clip`, `legend_compressor` ke `linked_compressor`, dan `legend_eq` ke `tone_shaper` melalui `legendHardwarePreviewModule()` di `frontend/src/lib/vstMakerDspPreview.js`. Ini sudah audible, level-matched, stabil, dan tersimpan, tetapi masih character-based approximation—belum circuit/model-specific DSP dan tidak boleh disebut emulasi 1:1.
- Inspirasi karakter yang sudah dijelaskan kepada pengguna, tanpa memakai merek/logo di UI: preamp British Class-A ≈ Neve 1073/1084, American Discrete ≈ API 312/512, Tube Broadcast ≈ Telefunken V72/EMI REDD, modern transformer ≈ RND/Great River; compressor FET ≈ 1176, optical ≈ LA-2A, VCA bus ≈ SSL G, vari-mu ≈ Fairchild/Manley; EQ passive tube ≈ Pultec, British console ≈ Neve/SSL, proportional-Q ≈ API 550, clean ≈ GML/Massenburg; tape mengacu pada karakter Ampex/Studer, 456, GP9, dan mastering deck bersih. Tetap gunakan nama generik/orisinal dalam produk.

### LANJUTKAN DARI SINI — dedicated browser DSP sebelum native

1. Mulai hanya setelah pengguna secara eksplisit meminta melanjutkan. Kerjakan frontend/browser DSP dahulu; jangan menyentuh compiler/native, worker Windows, builder macOS, pipeline revision, commit/push, atau membuka export native.
2. Tahap pertama yang direkomendasikan: buat processor khusus `legend_preamp` dan `legend_compressor` di `frontend/src/lib/vstDspProcessor.js`, bukan proxy ke `soft_clip`/`linked_compressor`:
   - Preamp: transformer frequency/phase response, saturasi asimetris Class-A/tube, harmonic response yang berubah terhadap input level, DC/high-pass handling, dan output transformer.
   - Compressor: detector berbeda untuk FET/optical/VCA/vari-mu, knee/ratio, program-dependent attack/release, serta distorsi yang mengikuti gain reduction.
3. Setelah pengguna menyetujui Preamp/Compressor, lanjutkan `legend_eq` dan `legend_tape`:
   - EQ: fixed frequency/bandwidth per architecture, proportional-Q, passive boost/cut interaction, phase response, dan output-stage color.
   - Tape: bias/hysteresis approximation, head bump, HF loss, transient compression, 7.5/15/30 ips, wow/flutter, serta noise opsional yang default-nya off.
4. Pertahankan gain-staging sebagai kontrak wajib: rack kosong identik dengan input; setiap default module level-matched; default full channel tidak boleh melonjak lebih dari sekitar `1.05×` RMS input; bypass/A-B tidak boleh mengubah loudness secara mengejutkan; sediakan headroom dan output ceiling yang aman.
5. Bila CPU memungkinkan, sediakan quality mode generik `Eco`, `Studio`, dan `HQ` dengan oversampling kira-kira 1×/2×/4×. Jangan mengklaim akurasi hardware tertentu tanpa measurement/reference captures. Untuk klaim lebih presisi diperlukan sweep, harmonic-vs-level, transient, timing compressor, dan noise dari unit referensi nyata.
6. Tambahkan tes audio deterministik untuk response, harmonics, gain staging, topology update, finite samples, dan perbedaan nyata antar-model. Ikuti mode hemat kuota: dua suite frontend fokus per batch, optimized build/deploy hanya pada gerbang pemeriksaan pengguna.
7. Setelah seluruh browser DSP disetujui pengguna, baru minta/terima izin sinkronisasi eksplisit untuk membawa algoritma dan parameter yang sama ke native Windows/macOS, membuka export, commit/push selektif, smoke lintas platform, worker overlay, dan revision backend.

- Empty-rack WAV audition sekarang benar-benar dry unity-gain. Sebelumnya `createDspPreviewPlan([])` memasang compatibility rack lama secara tersembunyi (termasuk Soft Clip dan Compressor), sehingga preview tanpa modul terdengar lebih keras dan pecah. `EffectPreviewLab` kini memakai audition plan khusus yang mengembalikan graph identity saat rack kosong; compatibility fallback project lama tetap tersedia pada konteks selain audition. Copy UI juga menyatakan `jalur dry unity-gain tanpa processor`. Tes audio membuktikan sampel output kosong identik dengan input.
- Bug layar blank setelah WAV preview aktif lalu topologi Legend Hardware ditambah sudah ditutup. Penyebabnya adalah hot replacement topologi AudioWorklet pada graph MediaElement yang sedang berjalan. Update parameter dengan topologi sama tetap realtime; perubahan jumlah/jenis modul kini menghentikan audition graph secara aman, menangkap port/DOM exception, dan pengguna dapat menekan `Lanjut` agar WAV dimulai kembali melalui chain baru. Tidak ada exception worklet yang dibiarkan menjatuhkan render React.
- Koreksi gain-staging sudah deployed setelah pengguna melaporkan volume melonjak saat memasang channel. Preamp dan Tape sekarang memakai kompensasi small-signal gain otomatis terhadap kurva saturasinya; Compressor default kembali `0 dB` makeup; EQ default benar-benar flat; Tape memberi sekitar `-1 dB` headroom. Preset lama yang persis cocok dengan factory default panas dimigrasikan otomatis, sedangkan nilai custom tidak diubah. Tes audio mengukur output default chain tidak lebih dari `1.05×` RMS input.
- Editor Sound sekarang memisahkan dua ruang: `Legend Hardware` dan `Studio DSP`. Jalur global ditampilkan sebagai Source → Legend Hardware → Studio DSP → Master sehingga rack lama tidak bercampur dengan perangkat baru.
- Tombol `Pasang Legend Channel` membuat urutan Preamp → Compressor → Equalizer → Tape. Masing-masing memiliki model karakter orisinal tanpa merek/logo pihak ketiga: empat circuit preamp, empat topology compressor, empat architecture EQ, serta empat formulation dan tiga speed tape. Pemilihan model memakai select, parameter kontinu memakai slider amber.
- Empat tipe tersimpan terpisah sebagai `legend_preamp`, `legend_compressor`, `legend_eq`, dan `legend_tape` di `engine_modules`; save/reload memakai normalisasi dan serialisasi rack yang sama. Browser preview memetakan karakter hardware ke processor realtime yang sudah stabil sehingga dapat diuji sekarang. Memasang rack DSP standar atau amp tidak menghapus Legend Hardware, dan hardware selalu ditempatkan sebelum Studio DSP.
- Label `Browser preview · native menyusul` tampil pada rack. Export Windows/macOS sengaja diblokir bila project memakai Legend Hardware agar build native yang belum sinkron tidak dapat terantre. Compiler/native, worker Windows, builder macOS, backend revision, commit, dan push belum disentuh sesuai gerbang frontend-first.
- Tes fokus hijau: `vstMakerDspRack.test.js` + `vstMakerDspPreview.test.js` = `34 passed`, termasuk dry identity, topology-change, dan rejected/closed AudioWorklet port; optimized frontend build sukses; `git diff --check` bersih. Production HTTP `200` untuk homepage dan `/admin/vst-maker`.
- Frontend production memakai JS `main.13ff07f7.js` (`sha256:3f0c58f1a100264835e824605f24531659bfc5e5c786640993c30ab96ac71995`) dan CSS `main.7bc127ef.css` (`sha256:ce9b8c207ba8a9af4fcfd7c1782ff516f60f90ba5e21c505586a5716048a19ed`); hash publik/lokal cocok.
- Langkah berikutnya tunggal: berhenti sekarang. Pada sesi berikutnya, baca bagian `LANJUTKAN DARI SINI`, lalu mulai dedicated browser DSP Preamp/Compressor hanya bila pengguna meminta melanjutkan. Jangan sinkronkan native berdasarkan handoff ini saja.

## MODE HEMAT KUOTA — WAJIB UNTUK SESI BERIKUTNYA

Gunakan pola ini agar pekerjaan tetap aman tanpa mengulang audit yang sudah selesai:

1. Baca hanya bagian atas handoff, maksimal sampai akhir bagian `LANJUTKAN DARI SINI` dan `MODE HEMAT KUOTA`. Jangan membaca seluruh riwayat deployment kecuali ada fakta tertentu yang memang perlu dicari. Perintah awal yang cukup:

   ```bash
   cd /home/triplesidestudio/tripleside
   awk '/^## SPESIFIKASI TUGAS ASLI/{exit} {print}' CODEX_HANDOFF.md
   git status --short
   ```

2. Anggap hasil tes dan audit yang tercatat di checkpoint terbaru sebagai bukti yang masih berlaku. Jangan mengulang tes yang sama sebelum ada perubahan pada file terkait. Setelah satu batch perubahan:
   - frontend saja berubah → jalankan dua tes frontend fokus;
   - backend saja berubah → jalankan dua tes backend fokus;
   - compiler/native saja berubah → jalankan tiga tes native fokus;
   - selalu akhiri dengan `git diff --check`; jalankan `py_compile` hanya bila Python berubah.

3. Jangan menjalankan full suite, optimized build, browser smoke, audit service, pemeriksaan worker, atau deployment selama iterasi biasa. Lakukan semuanya hanya sekali pada gerbang final dan hanya jika deployment memang diminta/diizinkan.

4. Jangan membuat sub-agent atau audit paralel untuk tugas ini. Gunakan satu agen, satu hipotesis, dan satu batch edit kecil. Cari dengan `rg`, lalu baca rentang kecil memakai `sed -n`; hindari mencetak file penuh, source map, direktori build/backup, log panjang, atau seluruh diff worktree.

5. Jangan mengaudit ulang komponen yang sudah tercatat selesai. Mulai dari bagian `yang belum dilakukan` atau kegagalan tes terbaru. Jika semua tes fokus relevan hijau dan pemeriksaan murah bersih, berhenti dan laporkan hasil; jangan mencari pekerjaan tambahan tanpa permintaan pengguna.

6. Commentary dibuat singkat: satu pesan saat mulai, satu pesan jika menemukan blocker/temuan penting, lalu hasil akhir. Jangan mengulang isi handoff di percakapan.

7. Bila sesi berhenti, perbarui hanya checkpoint paling atas dengan delta baru: file yang berubah, temuan terakhir, tes terakhir, dan tepat satu langkah berikutnya. Jangan menambahkan ulang penjelasan historis panjang.

8. Untuk perubahan yang juga memengaruhi runtime native, gunakan gerbang deployment dua tahap: deploy frontend lebih dahulu, lalu berhenti agar pengguna dapat memeriksa fungsi dan kebenarannya. Sinkronisasi worker Windows, builder macOS, commit/push native, dan smoke build lintas platform hanya dilakukan setelah pengguna menyatakan frontend sudah benar. Jangan menggabungkan kedua tahap tanpa konfirmasi eksplisit baru.

Prompt hemat kuota yang disarankan untuk sesi baru:

> Baca hanya checkpoint aktif di bagian atas `tripleside/CODEX_HANDOFF.md` sampai sebelum heading `SPESIFIKASI TUGAS ASLI`, ikuti `MODE HEMAT KUOTA`, lalu kerjakan hanya langkah berikutnya yang belum selesai. Jangan baca arsip deployment, jangan audit ulang pekerjaan yang sudah hijau, jangan gunakan sub-agent, dan jangan jalankan full suite/build/deploy tanpa izin saya. Gunakan tes fokus sesuai file yang benar-benar berubah dan perbarui checkpoint teratas bila berhenti.

## CHECKPOINT AKTIF — seluruh vector glow dan toggle meter sudah sinkron

- `ringGlowIntensity`/`ring_glow_intensity` sekarang masuk compiler manifest dengan clamp `0–100` dan default `65`; `ringThickness` tetap `1–16`, sedangkan waveform tetap `0.5–8`. Windows dan macOS menggambar active Open LED Ring sebagai vector runtime dinamis dengan stroke `control.colorRgb`, round cap, geometri halus, serta empat layer glow `12/.05`, `8/.075`, `5/.12`, dan `2.5/.2`. Intensitas `0` hanya menyisakan stroke solid; Pan center `50` tidak menggambar arc maupun marker.
- Capture/atlas kedua Open LED Ring hanya menyimpan idle track/backdrop: normal dipaksa ke `0`, Pan ke center `50`. Bounding box SVG disimpan di visual manifest untuk menyelaraskan vector runtime. Toggle meter kedua Studio Metal tetap menghormati `fader_meter_enabled=false` pada capture dan kedua runtime; saat aktif tetap kontinu non-LED dengan layout/warna tersimpan.
- Commit fitur `e0c892e253b61566ea21333cd5370598b7e40c7c`, koreksi compile Windows `88b0a545b3c797717f997d5e29733f2e477965f2`, dan bump revision `3f970dd59f675bed6d32dae2b9000fe9dac67191` sudah dipush. `HEAD == origin/main == 3f970dd59f675bed6d32dae2b9000fe9dac67191`; dirty worktree lain tidak di-stage atau diubah.
- Verifikasi hijau: tiga suite native fokus `124 passed`; seluruh `native-vst3/tests` `163 passed`; backend fokus setelah bump revision `56 passed`; Python compile dan `git diff --check` bersih. Baseline frontend tetap `68 passed`, optimized build, dan smoke browser production yang sudah hijau.
- Windows smoke final run `40707980434` sukses; artifact `12825415948`, digest `sha256:ba752ba7e27cf6c759cd140da2840a7240107cc1deefc4b6b95b5bce896cf818`. macOS Universal final run `40707986627` sukses; artifact `12825357691`, digest `sha256:42c85845864f3e857fe0d060c3ebec62da4e73d76df3a08436a083f172c7faa5`.
- Worker Windows di-overlay terbatas pada `NativeView.cpp/.h`, `compile_manifest.py`, dan `render_visual_assets.py` setelah active customer/all builds serta jobs `0`. Hash remote/lokal cocok: `7a555243...10d39`, `3fabd2bc...1981a`, `45c5d8e3...3a0ff`, dan `cf8918ff...be6c`. Backup rollback: `C:\TripleSideWorker\backups\open-ring-vector-glow-before-20261028T1450Z`. Task `Running`, satu worker PID `4520`, jobs `0`.
- Backend production memakai pipeline revision `open-ring-vector-glow-v1`; PM2 PID `61757`, `online`, unstable restarts `0`. API lokal/publik, homepage, visual route, dan Nginx sehat. Active customer/all builds `0`; workflow customer macOS aktif `0`. Tidak ada job/artifact pelanggan yang dibuat, retry, cancel, claim, atau dimutasi.
- Frontend production tetap memakai JS `main.710f3c10.js` (`sha256:9afb3f5c910c4791841c503f6b692460457907e26cc46a3901f94ee4ad4eaeba`) dan CSS `main.accd76f9.css` (`sha256:9af4597b39b7ea78739c9bf0dc27aa46683790fe4fcea3087c7d60dcc0291cab`); hash publik/lokal cocok. Backup rollback frontend tetap `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T135935Z-before-vector-glow`.
- Seluruh permintaan sinkronisasi aktif selesai. Langkah berikutnya tunggal: pengguna dapat membuat build baru melalui alur normal untuk memeriksa Open LED Ring/Pan dan toggle meter Studio Metal di DAW; jangan membuat build pelanggan atas inisiatif agen.

## SINKRONISASI FINAL — selesai 2026-10-28

Pengguna sudah meminta secara eksplisit: **“buat handoff untuk sinkronkan semua”**. Anggap frontend production terbaru sudah menjadi baseline yang harus disinkronkan penuh. Jangan meminta persetujuan frontend/native lagi dan jangan mengulang optimized frontend build atau smoke browser yang sudah hijau. Mulai langsung dari parity compiler/native berikut:

1. Tambahkan `ringGlowIntensity`/`ring_glow_intensity` ke compiler manifest `ControlInfo` dengan clamp `0–100`, default `65`, sementara `ringThickness` tetap `1–16` dan waveform tetap `0.5–8`.
2. Buat Open LED Ring Windows/macOS sebagai vector runtime dinamis, bukan active ring dari PNG atlas:
   - busur track terbuka `270°`, active arc dari minimum untuk normal dan dari center untuk Pan;
   - Pan `value==50` tidak menggambar active arc maupun marker;
   - active stroke memakai `control.colorRgb`, ketebalan `ringThickness`, round cap, geometri halus;
   - glow mengikuti empat layer vector frontend (`spread/opacity`: `12/.05`, `8/.075`, `5/.12`, `2.5/.2`) dikalikan intensitas `0–100`; intensitas `0` berarti hanya active stroke solid tanpa halo;
   - atlas/capture kedua varian hanya boleh menyimpan idle track/backdrop agar active arc tidak tergambar ganda. Untuk Pan, idle capture harus memakai center `50`, bukan frame `0` yang menyalakan sisi kiri.
3. Pertahankan toggle meter kedua Studio Metal: `fader_meter_enabled=false` harus menyembunyikan meter pada capture, Windows, dan macOS; bila aktif tetap kontinu non-LED dengan posisi/gap/lebar/tinggi/warna yang sudah ada.
4. Tambah kontrak test pada tiga suite native fokus (`test_compile_manifest.py`, `test_runtime_source_contract.py`, `test_visual_capture_resilience.py`). Jalankan tiga suite fokus, lalu seluruh `native-vst3/tests` sekali pada gerbang final. Frontend `68 passed`, backend `56 passed`, Python compile, optimized build, dan smoke production terbaru sudah berlaku—jangan diulang kecuali file terkait kembali berubah.
5. Commit/push hanya file terkait. Delta frontend/backend yang belum di-commit sekarang berada pada enam path: `frontend/src/pages/VstMakerPreview.jsx`, `.css`, `VstVisualRender.jsx`, `VstMakerPreview.templateEditing.test.js`, `backend/routers/vst_maker.py`, dan `backend/tests/test_vst_maker_build_spec.py`. `HEAD==origin/main==eb71c2bcc45ae515dee74dc35b2e0be955b02419`; jangan stage dirty worktree lain.
6. Jalankan smoke Windows dan macOS Universal untuk commit final. Setelah sukses dan active customer/all builds serta worker jobs `0`, backup lalu overlay hanya source Windows terkait, cocokkan SHA-256, hidupkan task, dan pastikan satu worker aktual `Running`. macOS customer builder memakai default branch `main` setelah push.
7. Setelah worker final, naikkan pipeline revision production dari `studio-metal-open-ring-v1` ke revision baru, misalnya `open-ring-vector-glow-v1`, restart backend terkontrol, dan verifikasi PM2/API/Nginx/hashes/active builds. Jangan membuat, retry, cancel, claim, atau memutasi job/artifact pelanggan.
8. Perbarui checkpoint paling atas dengan commit SHA, workflow run/artifact/digest, hash worker, backup rollback, revision backend, hasil tes, dan status bahwa seluruh glow vector serta toggle meter sudah sinkron.

## CHECKPOINT FRONTEND SEBELUM SINKRONISASI — Open LED Ring sepenuhnya vector tanpa raster filter

- Kedua Open LED Ring sekarang memiliki pengaturan terpisah `Intensitas nyala ring` `0–100%` melalui `ringGlowIntensity`/`ring_glow_intensity`; default project lama `65%`. Active arc memakai koordinat lima desimal, SVG `shape-rendering="geometricPrecision"`, dan computed `filter:none`. Seluruh raster filter sudah dihapus: tidak ada CSS `drop-shadow`, SVG `<filter>`, atau `feGaussianBlur`. Halo dibentuk oleh empat stroke vector transparan berlapis di belakang garis utama; pada `0%` tidak ada layer halo. Pan center tetap tidak menggambar active arc maupun marker.
- `Studio Metal` dan `Studio Metal Long Cap` tidak lagi memaksa meter selalu aktif. Inspector kembali menyediakan `Tampilkan/Sembunyikan` yang dapat dipilih; saat tampil meter tetap kontinu non-LED dan pengaturan posisi, jarak, lebar, tinggi, serta warna tetap tersedia. Save/reload dan visual render menghormati `fader_meter_enabled=false`.
- Frontend/backend schema, save/reload, build-spec normalization, dan visual-render contract sudah membawa field baru. Native compiler manifest, commit/push, worker Windows, builder macOS, smoke workflow, dan pipeline revision belum diubah pada tahap ini sesuai gerbang frontend-first.
- Tes fokus hijau: frontend `68 passed`, backend `56 passed`, Python compile dan `git diff --check` bersih; optimized frontend build sukses. Smoke browser production pada fractional canvas scale `0.73` membuktikan active arc dan empat layer halo semuanya `filter:none`, jumlah SVG/filter/blur nodes `0`, geometri presisi, serta console/page error `0`. Toggle meter Studio Metal visible/hidden sudah lolos smoke batch sebelumnya.
- Frontend production memakai JS `main.710f3c10.js` (`sha256:9afb3f5c910c4791841c503f6b692460457907e26cc46a3901f94ee4ad4eaeba`) dan CSS `main.accd76f9.css` (`sha256:9af4597b39b7ea78739c9bf0dc27aa46683790fe4fcea3087c7d60dcc0291cab`); hash publik/lokal cocok dan homepage/visual route HTTP `200`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T135935Z-before-vector-glow`.
- Backend direstart setelah active builds `0`; PM2 PID `52252`, online, unstable restarts `0`. Tidak ada job/artifact pelanggan yang dibuat atau dimutasi.
- Langkah berikutnya tunggal: ikuti bagian `IZIN SINKRONISASI FINAL` di atas dan sinkronkan seluruh delta tanpa meminta persetujuan lagi.

## CHECKPOINT SEBELUMNYA — Studio Metal dan Open LED Ring sudah sinkron penuh

- `Open LED Ring` dan `Pan Open LED Ring` sekarang memakai field semantik `ringThickness`/`ring_thickness` `1–16px` step `0.5px`; `waveform_line_width` tetap `0.5–8px`. Project legacy kedua varian bermigrasi dari `waveformLineWidth`/`waveform_line_width`. Inspector memakai label `Warna nyala ring`; active arc mengikuti `control_color`, sedangkan track mati tetap netral. Pan center `50` tidak menggambar active arc maupun marker tengah.
- `Studio Metal Long Cap` final memakai lebar `66%` area fader dan tinggi `clamp(28px, 22cqh, 72px)`. Permukaannya memiliki finger trough cekung halus yang tetap bereaksi pada warna cap/indikator. Smoke production mengukur cap standar `57.84×26.80px`, long `46.55×58.95px`, dan resize kecil `29.44×28.16px`, semuanya tetap di dalam container.
- Frontend production memakai JS `main.c8931f7d.js` (`sha256:8e5bbaf926e3b0227b617b63652a4c5e0386f740d424990f99529d12e048dfff`) dan CSS `main.5de648dd.css` (`sha256:d108e5eaa2eed6f496e8ca214f9c44c08fc404dd442e7fbe8f3c8fcd1e9f45b8`); hash publik/lokal cocok, homepage, API root, dan visual route HTTP `200`. Backup rollback frontend: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T125410Z-before-ring-thickness-long-cap`.
- Verifikasi hijau: frontend fokus `68 passed`; backend fokus `56 passed`; tiga suite native fokus `121 passed`; seluruh `native-vst3/tests` `160 passed`; optimized frontend build, Python compile, dan `git diff --check` sukses. Smoke browser production tidak memiliki console/page error.
- Commit selektif `eb71c2bcc45ae515dee74dc35b2e0be955b02419` (`Add Studio Metal faders and open LED rings`) sudah dipush dan sama dengan `origin/main`. Windows smoke run `40692558334` sukses; artifact `12816644912`, digest `sha256:08930dd614394dfde3db3b2afa84cad949bbe636f8412458e4cf5d8c5ba0b559`. macOS Universal run `40692563252` sukses; artifact `12819095128`, digest `sha256:e71a8607e6392cc6fa0065a75bb07f4db4611ac562bf9295e0b5524f3b373815`.
- Worker Windows di-overlay terbatas hanya pada `compile_manifest.py` setelah active builds/jobs `0`; hash remote/lokal cocok `927ef5d5a5b15377d1fecb14b54f7e0707ffc87a5efb2d2cd8cf7689093b07d8`. Backup rollback: `C:\TripleSideWorker\backups\studio-metal-open-ring-before-20261028T130159Z`. Task `Running`, satu worker PID `3544`, jobs `0`. Builder macOS memakai default branch `main`; workflow customer aktif `0`.
- Backend production memakai pipeline revision `studio-metal-open-ring-v1`, PM2 PID `50408`, `online`, unstable restarts `0`; Nginx valid. Active customer/all builds tetap `0`; tidak ada job/artifact pelanggan yang dibuat, diulang, dibatalkan, atau dimutasi.
- Seluruh permintaan aktif sudah selesai. Langkah berikutnya tunggal: pengguna dapat membuat build baru melalui alur normal untuk memeriksa kedua ring dan Studio Metal di DAW; jangan membuat build pelanggan atas inisiatif agen.

## PERMINTAAN LANJUTAN PENGGUNA — selesai dan seluruh delta sudah sinkron

Pengguna sudah menyatakan hasil frontend terakhir benar dan sekarang memberi izin eksplisit untuk menyinkronkan seluruh rangkaian perubahan Studio Metal serta Open LED Ring setelah koreksi berikut selesai. Izin ini menggantikan instruksi `jangan sinkronkan` pada checkpoint sebelumnya; tidak perlu meminta persetujuan sinkronisasi kedua kali. Tetap lakukan pemeriksaan visual frontend final sebelum menyentuh native/compiler.

1. `Open LED Ring` dan `Pan Open LED Ring`:
   - Naikkan batas ketebalan di atas `8px`; target awal yang disetujui untuk implementasi adalah `1–16px` dengan step `0.5px` dan default tetap sekitar `5px`.
   - Jangan memperlebar batas global `waveform_line_width` milik waveform. Buat field semantik khusus `ringThickness` / `ring_thickness` lintas frontend, schema backend, normalisasi project/build spec, visual-render contract, compiler/native manifest, dan test. Migrasikan nilai legacy kedua varian dari `waveformLineWidth` / `waveform_line_width` agar project yang sudah dibuat tidak kehilangan ketebalan.
   - Ubah label inspector menjadi `Warna nyala ring`; warna aktif harus benar-benar mengikuti nilai `control_color`, termasuk preview, reload project, visual capture, Windows, dan macOS. Track mati tetap gelap/netral dan tidak ikut menjadi warna aktif.
   - Untuk Pan, `0` berarti center detent (`value === 50`). Pada posisi ini tidak boleh ada cahaya aktif sama sekali: tidak ada active arc dan tidak ada marker/dot tengah menyala. Track mati boleh tetap terlihat. Nilai ke kiri/kanan baru menyalakan segmen dari center menuju posisi nilai.
   - Pertahankan busur terbuka `270°`, ujung kiri/kanan membulat, tanpa badan knob dan tanpa titik artefak di endpoint.

2. `Studio Metal Long Cap`:
   - Buat cap jauh lebih ramping daripada kondisi `76%` sekarang; mulai dari kira-kira `64–68%` lebar area fader lalu tentukan hasil final melalui screenshot perbandingan dengan cap standar pada ukuran kontrol sama.
   - Tambah panjang simetris ke atas dan bawah dari garis indikator; target awal `22cqh` dengan clamp kira-kira `28–72px`, lalu pastikan tidak keluar container pada ukuran default maupun resize kecil.
   - Tambahkan efek cekung analog yang halus dan meyakinkan, bukan sekadar border-radius, bevel acak, atau lubang gelap. Bentuk yang dimaksud adalah finger trough dangkal pada permukaan metal: bibir atas/bawah menerima highlight tipis, area tengah turun perlahan dengan shadow lembut, dan pantulan metal/groove mengikuti kontur. Garis indikator tetap berada tepat di pusat cekungan dan cap tetap tampak sebagai satu benda metal realistis.
   - Pertahankan pengaturan `Warna badan cap fader` serta `Warna garis indikator cap`; `color-mix`/highlight/shadow harus tetap bereaksi masuk akal pada warna cap terang maupun gelap.

3. Gerbang verifikasi dan sinkronisasi yang sudah diizinkan:
   - Ubah frontend dalam satu batch kecil, jalankan hanya dua suite fokus yang tercatat, optimized build sekali, deploy production, lalu smoke visual untuk: ketebalan minimum/maksimum, warna aktif custom, Pan center tanpa active light, Pan kiri/kanan, perbandingan cap standar/long, dan resize kecil.
   - Setelah frontend final lolos pemeriksaan tersebut, lanjutkan tanpa menunggu konfirmasi baru: audit dan implementasikan parity backend/compiler/native, tambah test kontrak yang relevan, lalu jalankan tiga suite native fokus dan full `native-vst3/tests` hanya pada gerbang final.
   - Commit/push hanya file yang benar-benar terkait; jangan `git add -A`, jangan memasukkan dirty worktree lain, dan jangan reset/clean. Bila file relevan masih untracked baseline, stage hanya path relevan setelah memeriksa scope diff.
   - Jalankan smoke workflow Windows dan macOS Universal untuk commit final. Overlay source worker Windows hanya setelah active customer/all builds dan jobs sama-sama `0`, buat backup rollback, cocokkan hash source, dan pastikan task worker kembali `Running`. Builder macOS memakai default branch setelah push.
   - Jangan membuat, retry, atau memutasi job/artifact pelanggan. Perbarui pipeline revision/backend hanya bila memang diperlukan oleh schema/build contract baru, kemudian verifikasi PM2 stabil, endpoint lokal/publik `200`, hashes production cocok, dan `HEAD == origin/main`.
   - Akhiri dengan checkpoint baru berisi commit SHA, workflow run/artifact/digest, hash worker, backup rollback, bundle frontend, hasil tes, serta status bahwa seluruh perubahan Studio Metal dan Open LED Ring sudah sinkron.

## CHECKPOINT AKTIF — long cap dan knob Open LED Ring frontend-first sudah deployed

- Seluruh garis tick dan angka skala di sisi kanan sudah dihapus dari varian `Studio Metal`; jalur fader sekarang dipusatkan. Meter audio live tetap berupa satu bar kontinu non-LED di kiri dengan posisi, jarak, ukuran, dan warna yang dapat diatur.
- Varian kedua `Studio Metal Long Cap` sekarang lebih ramping daripada cap standar (`76%` vs `82%` lebar area fader) dan lebih panjang simetris ke atas/bawah dari garis indikator (`20cqh`, clamp `24–64px`). Smoke produksi final mengukur cap long `53.61×53.59px` pada kontrol `118×280`.
- Kedua varian memiliki dua pengaturan warna terpisah di inspector: `Warna badan cap fader` memakai `control_color`, dan `Warna garis indikator cap` memakai `text_color`. Shading metal serta groove dipertahankan melalui `color-mix`, sehingga pilihan warna tidak membuat cap tampak datar.
- Dua varian knob baru ditambahkan: `Open LED Ring` pada kategori Knob dan `Pan Open LED Ring` pada kategori Pan. Keduanya hanya berupa busur terbuka 270° tanpa badan knob, memakai SVG dengan ujung kiri/kanan membulat. Versi normal mengisi dari ujung minimum; versi Pan mengisi secara bipolar dari marker tengah menuju kiri/kanan.
- Inspector kedua knob menyediakan `Ketebalan ring` `1–8px` (disimpan melalui `waveform_line_width`) dan `Warna ring` (melalui `control_color`). Segmen aktif digambar sebagai path geometris terpisah agar tidak menghasilkan titik artefak pada ujung busur.
- Smoke visual production mengonfirmasi dua SVG, dua active path tanpa dash berulang, ketebalan custom `3px`/`7px`, marker tengah Pan, elemen skala fader `0`, serta long cap final. Tes fokus frontend hijau: dua suite, `68 passed`; `git diff --check` bersih dan optimized frontend build sukses.
- Frontend production memakai JS `main.68be5936.js` (`sha256:46e18c0b7d031f22b7758883e260e5db237e7fe8e73fbd2f800f63a2c3c6e9ae`) dan CSS `main.a62e0d3b.css` (`sha256:248b65adbd99fed4dc014247621dca0223832de7ab6a9a50c5facefc7718dffe`); hash publik/lokal cocok dan visual route publik HTTP `200`. Backup sebelum batch knob: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T123050Z-before-open-ring-knobs`; backup sebelum koreksi endpoint busur final: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T123312Z-before-open-ring-arc-endpoint-fix`.
- Tidak ada perubahan native, commit, push, overlay worker, atau job pelanggan untuk varian ini. `HEAD` dan `origin/main` tetap cocok pada `4d9335bd40d53b260c4e35f9d05752cb287f4938`.
- Checkpoint frontend ini sudah dinyatakan benar oleh pengguna. Langkah berikutnya adalah mengerjakan bagian `PERMINTAAN LANJUTAN PENGGUNA` di atas, kemudian menyinkronkan seluruh delta sesuai izin eksplisit terbaru.

## CHECKPOINT SEBELUMNYA — tombol editor dan warna Solo/Mute native sudah sinkron

- Tombol hapus dan tombol ganti komponen sekarang memakai ukuran serta offset responsif yang sama berdasarkan sisi terpendek container. Saat komponen diperkecil, keduanya mengecil dari 20 px sampai 15 px dan bergeser bertahap sampai 6 px keluar dari sudut agar tidak menutupi permukaan kontrol.
- Penyebab warna aktif Solo/Mute berbeda sudah diperbaiki: Windows/macOS sekarang memakai campuran background 24%, border, dan teks yang sama dengan CSS preview `color-mix(in srgb, ...)`, bukan lagi warna pilihan 100%.
- Tes hijau: frontend `67 passed`; tiga suite native fokus `121 passed`; seluruh `native-vst3/tests` `160 passed`; `git diff --check` bersih. Optimized frontend build sukses.
- Frontend production memakai JS tetap `main.9bb3c156.js` (`sha256:020e9fca...f486fa`) dan CSS baru `main.2a834313.css` (`sha256:33ad89a4...62ac57`); hash publik/lokal cocok dan visual route HTTP `200`. Perintah backup baru sebelum build salah memakai path relatif ganda sehingga tidak membuat backup; rollback terakhir yang tersedia adalah `frontend/build-backup-20261028T0442Z-before-replace-settings-wing-center`.
- Native sudah di-commit/push sebagai `b281f9a` (`Match native solo mute active colors`) dan koreksi scope macOS `4d9335bd40d53b260c4e35f9d05752cb287f4938` (`Expose native color mixer to macOS view`). `HEAD` dan `origin/main` cocok pada `4d9335b`; tidak ada perubahan knob yang ikut commit.
- Smoke final untuk SHA `4d9335b` sukses: macOS Universal run `40673583087`, artifact `12808923942`, digest `sha256:e199e1...b15772`; Windows run `40673587278`, artifact `12809786923`, digest `sha256:0e4fff...a8ed4a`. Run macOS pertama menangkap scope helper yang salah lalu digantikan; run Windows lama non-final dibatalkan agar slot dipakai run final.
- Worker Windows sudah di-overlay terbatas pada `NativeView.cpp` saat active builds/jobs `0`; hash worker/source cocok `BE5B86E5...287A7BD`, scheduled task tetap `Running`, jobs `0`. Backup rollback: `C:\TripleSideWorker\backups\solo-mute-color-before-20261028T104231Z`. macOS customer builder mengambil source default branch yang sudah final.
- Pipeline production aktif `solo-mute-color-parity-v1`; backend PID `36742`, PM2 `online`, unstable restarts `0`, endpoint produk lokal dan homepage publik HTTP `200`. Active builds tetap `0`; tidak ada job/artifact pelanggan yang dibuat atau diulang.
- Langkah berikutnya: pengguna dapat membuat build baru dari UI untuk memeriksa warna Solo/Mute. Jangan retry job pelanggan dari server tanpa permintaan eksplisit.

## CHECKPOINT SEBELUMNYA — kegagalan build Solo + Mute sudah diperbaiki

- Job Windows `9b49dcdf-3a2d-457f-af45-2d14cf626f3f` gagal dua kali karena `native-vst3/tools/render_visual_assets.py` belum memasukkan kind `solo_mute` ke `SUPPORTED_CONTROL_KINDS`; capture berhenti dengan `ValueError: This project contains a component not supported by the visual asset contract` sebelum kompilasi.
- Renderer sekarang menerima `solo_mute` dan menyimpan satu frame idle karena status Solo/Mute live tetap digambar dari parameter grup oleh runtime native. Tes regresi ditambahkan; seluruh suite `native-vst3/tests` lulus `160 passed`.
- Koreksi minimal sudah di-commit dan dipush ke `origin/main` sebagai `fc83975e0ff57559feb459ffac7e1834a53732cc` (`Allow solo mute visual capture`). Perubahan test fader yang sudah ada sebelumnya tetap tidak ikut commit.
- Worker Windows sudah di-overlay saat active builds dan job directories sama-sama `0`. Hash source worker `0FDCE11D...EE295FD` cocok dengan VPS; scheduled task `TripleSide VST Build Worker` tetap `Running`. Backup rollback: `C:\TripleSideWorker\backups\solo-mute-visual-contract-before-20261028T0930Z`.
- Pipeline production aktif dinaikkan menjadi `solo-mute-visual-contract-v1`, backend direstart terkontrol dan stabil: PM2 `online`, unstable restarts `0`, endpoint produk lokal HTTP `200`, situs publik HTTP `200`. Job gagal lama tidak diulang atau dimutasi.
- Langkah berikutnya: pengguna membuat build baru dari UI untuk project yang sama. Revisi pipeline baru mencegah deduplikasi ke job gagal lama. Jangan membuat/retry job pelanggan dari server tanpa permintaan eksplisit.

## LANJUTKAN DARI SINI — binding komponen ke sampler sudah deployed

Deployment frontend/backend dan sinkronisasi source worker Windows selesai pada 2026-10-26. Lanjutkan dari worktree yang ada; **jangan reset/clean** karena repo memang sangat dirty dan beberapa file inti tercatat untracked. Jangan membuat build/job pelanggan atau mengubah artifact lama. Implementasi lintas frontend/backend/compiler/native untuk `sampler_group_id`, analyser per sampler, note targeting, Combo Box Output lokal dua pilihan, dan label kosong sekarang aktif di production.

Diagnosis read-only terbaru untuk project tersimpan `Neon Pop Rock Drums`:

- Ada dua record bernama sama. Record lama `8ecf96f3-7b09-45e2-825d-1baf46440e7a` masih memiliki satu sampler dan child Mixer `tone` tanpa `sampler_group_id`; bila record ini dibuka, perilaku lama memang tetap terlihat. Record terbaru `092b3d46-6e53-44bf-b5c8-2ecfb272bce2` sudah memiliki Kick/Snare dan binding fader, meter, serta Output yang benar.
- Pada record terbaru, posisi child Mixer memang tersimpan bergerombol pada `x=14..34%` dengan label skin panjang seperti `LED Track 24`, `LED Peak 25/26`, dan `LED Track 21 Copy`. Render production mereproduksi data ini sehingga label/control tampak bertumpuk; ini bukan kehilangan binding saat reload.
- Meter browser membaca analyser tanpa smoothing (`smoothingTimeConstant = 0`), memakai attack instan dan decay tetap per `requestAnimationFrame`, sehingga transient drum serta frame-rate yang berubah terlihat melompat. Renderer atlas macOS juga membaca peak/RMS langsung tanpa state smoothing; Windows sudah memiliki decay berbasis elapsed time. Tidak ada project/customer data yang diubah pada diagnosis ini.
- Bug fader Snare sudah dilokalisasi ke preview browser, bukan data binding project. Record terbaru menyimpan fader Snare pada indeks 17 sebagai `parameter: volume` + `sampler_group_id: f59e...`, sedangkan fader Kick berada pada indeks 23. Helper `macroValue("volume")` memilih kontrol volume non-pad pertama tanpa mengecualikan kontrol bertarget sampler, sehingga fader Snare juga dipakai sebagai volume master global. Jalur voice kemudian mengalikan volume grup lokal dengan nilai global tersebut; akibatnya Snare berubah secara lokal sekaligus semua sampler ikut mengecil. Pola yang sama berpotensi mengenai Pan/Mute/Solo bertarget sampler. Tidak ada source atau project/customer data yang diubah pada diagnosis ini.

Delta frontend-first terbaru pada 2026-10-27:

- `globalMacroValue` sekarang mengabaikan kontrol dengan `sampler_group_id`, sehingga Volume/Pan/Mute/Solo sampler tidak lagi menjadi macro master. Meter browser memakai smoothing attack/release berbasis elapsed time dan analyser `0.72` agar animasi stabil lintas frame rate.
- Setelah pemeriksaan pengguna berikutnya, pembacaan analyser pada `PreviewOutputMeter` tetap memakai ref sumber terbaru tanpa me-restart loop animasi. Double smoothing dihapus: transisi CSS `height 55ms` yang terus di-reset setiap frame sudah dilepas, sementara envelope elapsed-time memakai attack peak lebih cepat `12ms` dan release `300ms` agar transient drum terlihat namun turun mulus. Angka dB tetap berupa overlay absolut, dan label meter kosong tetap aman.
- Combo Box canvas tetap menampilkan nama sampler saat tertutup dan menu `Master`/`OutN` saat dibuka. Ukuran font trigger dikembalikan ke ukuran asli. Jika `OutN` aktif, hanya border yang berubah ke warna aksen dan caret netral berubah menjadi panah kanan kecil berwarna aksen; background serta warna teks tetap. Source native tertunda mengikuti kontrak border/panah yang sama. Perubahan native belum di-commit, belum di-push, dan belum disinkronkan ke worker/builder.
- Tes fokus terakhir hijau: frontend `52 passed`, native `112 passed`, serta `git diff --check` bersih. Optimized frontend build kelima sukses.
- Frontend production sekarang memakai `main.55df7780.js` (`sha256:c454174dceff1758488febcfc0a5f0c237c540220622310aa744c9213e68fcb3`) dan `main.f22ad7d7.css` (`sha256:1f485cd7eaea1961c5649194d94affbf3db2e345fb115319681444a6922e0d87`); hash publik/lokal JS cocok dan homepage publik HTTP `200`. Backup rollback terbaru: `/home/triplesidestudio/tripleside/frontend/build-backup-20261027T045749Z-before-output-arrow`.
- Pengguna sudah menyatakan frontend final mantap. Delta native terbatas sudah di-commit dan dipush ke `origin/main` sebagai `c5189856b4525c8b76903d899a738e6ab49d9a56` (`Smooth sampler meters and clarify output routing`). Commit hanya berisi `NativeInstrument.cpp`, `NativeView.cpp`, `NativeViewMac.mm`, dan source-contract test; dirty worktree frontend/backend tidak ikut ter-stage.
- Dua smoke workflow commit tersebut sudah selesai sukses: Windows run `40453070664` dan macOS Universal run `40453074122`, keduanya untuk head SHA `c5189856b4525c8b76903d899a738e6ab49d9a56`. Jangan memulai run pengganti.
- Worker Windows sudah di-overlay terbatas ke delta commit `c518985` setelah active customer/all builds `0` dan jobs `0`: `NativeInstrument.cpp` hash `5e4d1208...4457` dan `NativeView.cpp` hash `5f56f04c...41b` cocok dengan source VPS/commit. Backup rollback: `C:\TripleSideWorker\backups\sampler-meter-output-before-20261027T053806Z`. Task kembali `Running`, tepat satu proses worker PID `6120`, jobs `0`. Worker macOS tidak memiliki checkout persisten: workflow customer memakai `actions/checkout` dari default branch; `origin/main` sudah `c518985` dan smoke macOS untuk SHA tersebut sukses, sehingga build macOS berikutnya memakai source baru. Workflow customer terakhir yang benar-benar didispatch masih SHA `1d3bd203` karena belum ada job macOS setelah push.

Delta frontend-first Tuning/Fine Tune terbaru:

- Modul `Tuning & Fine Tune` sekarang menampilkan pilihan `DSP Master` atau `DSP · [sampler]`, sama dengan modul DSP lain. Beberapa modul Tuning dapat dipasang, tetapi hanya satu per target. Modul pertama default ke Master; modul berikutnya otomatis memilih sampler kosong pertama. Target yang sudah dipakai dinonaktifkan di dropdown dan penambahan ditolak bila semua target terisi.
- Preview browser memakai pemilihan target spesifik: tuning sampler meng-override tuning Master untuk sampler tersebut, sedangkan sampler tanpa tuning khusus dan Wave Generator tetap memakai Master. Nilai tidak pernah dijumlahkan dua kali. Penghapusan sampler meretarget modul orphan ke target kosong yang aman atau menghapusnya dan membersihkan binding bila tidak ada slot.
- Target tetap disimpan sebagai `sampler_group_id` modul; kontrol knob terikat memakai `module_id` tanpa `sampler_group_id` kontrol. Backend sekarang menerima beberapa modul Tuning dengan target unik dan menolak target duplikat. Export Windows/macOS untuk tuning per-sampler sementara dijaga dengan HTTP `503` sampai runtime native selesai, sehingga artifact salah tidak dapat dibuat.
- Dropdown `Target modul` pada inspector komponen sekarang menampilkan nama target, misalnya `Tuning & Fine Tune · DSP Master`, `Tuning & Fine Tune · Kick`, dan `Tuning & Fine Tune · Snare`. Dua DSP non-Tuning dengan nama serta target sama juga mendapat suffix `#1/#2`, tanpa mengubah ID atau binding tersimpan.
- Seluruh dropdown modul komponen sekarang konsisten memakai label target tersebut, termasuk dropdown khusus `Compressor target` pada Gain Reduction meter. Inspector Solo/Mute menampilkan `Target Solo`/`Target Mute` dengan pilihan Master dan seluruh sampler.
- Bug Solo/Mute preview diperbaiki: sebelumnya keberadaan Solo membuat rumus hanya membaca `group.solo` dan mengabaikan `group.mute`; sekarang `Mute` selalu menang, sama dengan runtime native. Beberapa sampler boleh memakai Solo bersamaan. Mematikan salah satu Solo hanya mematikan Solo sampler tersebut; selama Solo lain masih aktif, sampler non-Solo tetap tidak terdengar sesuai perilaku multi-solo standar. Project/draft legacy mempertahankan seluruh Solo yang valid. Audit read-only record terbaru Neon Pop Rock Drums menemukan Kick dan Snare sama-sama `solo: true`; keadaan tersebut sekarang valid dan dipertahankan. Hanya child Solo/Mute Kick yang tersimpan, sedangkan tombol Mute global tidak bertarget. Tidak ada data database yang diubah langsung.
- Mute dan Solo pada sampler yang sama sekarang saling eksklusif pada seluruh jalur editor: menyalakan M mematikan S target dan menyalakan S mematikan M target, tetapi tidak mengubah Solo sampler lain. Normalisasi draft/project/preset serta serializer hanya membersihkan konflik M+S pada group yang sama; backend hanya menolak konflik M+S tersebut dan menerima beberapa Solo aktif.
- Tes fokus frontend lulus `85 passed`; backend build-spec/lifecycle/queue lulus `67 passed`; Python compile dan `git diff --check` bersih. Optimized frontend build sukses.
- Koreksi multi-solo terakhir lulus frontend `60 passed`, backend build-spec/lifecycle `53 passed`, Python compile, dan `git diff --check`; optimized build sukses. Frontend production memakai `main.d816264b.js` (`sha256:f5588ed9aa6196fa28478992e1a66b400503bf7bb1f052aa4c22f77c75e1d60f`) dan `main.f22ad7d7.css` (`sha256:1f485cd7eaea1961c5649194d94affbf3db2e345fb115319681444a6922e0d87`); hash publik/lokal cocok. Backup rollback terbaru: `/home/triplesidestudio/tripleside/frontend/build-backup-20261027T065659Z-before-multi-solo`. Backend PM2 PID `1782008`, status `online`, unstable restarts `0`; API lokal/publik, homepage, dan visual route HTTP `200`; Nginx valid. Active customer/all builds tetap `0` sebelum dan sesudah deployment.
- Compiler/runtime native Windows/macOS untuk target tuning belum diubah atau disinkronkan pada gerbang frontend-first ini. Tidak ada build/job pelanggan yang dibuat; active customer/all builds `0` sebelum deployment.

Delta frontend-first metering bawaan Fader terbaru:

- Semua komponen `fader`, termasuk skin CSS/filmstrip dan Pitch Bend/Modulation berbasis fader, sekarang memiliki meter audio mono yang aktif secara default dan berada di dalam bounding box komponen yang sama. Meter tidak membuat komponen canvas terpisah sehingga tidak berisiko bertumpuk dengan fader lain.
- Meter mengambil analyser Master untuk fader global dan analyser sampler untuk fader yang mempunyai `sampler_group_id`. Inspector menyediakan `Tampilkan/Sembunyikan`, posisi `Kanan/Kiri fader`, warna level bergerak, serta jarak horizontal `0–32 px`.
- Konfigurasi persisten memakai `fader_meter_enabled`, `fader_meter_position`, `fader_meter_color`, dan `fader_meter_gap`; save/reload, build spec, dan `/vst-visual-render` mempertahankannya. Project/fader lama tanpa field mendapat default meter tampil di kanan, warna `#22C55E`, jarak `4 px`.
- Backend menerima dan memvalidasi konfigurasi tersebut. Sampai renderer native disinkronkan, build Windows/macOS yang masih mengaktifkan meter bawaan fader ditolak aman dengan HTTP `503`; menonaktifkan meter tidak memicu guard ini.
- Tes fokus terakhir lulus: frontend `62 passed`, backend build-spec/lifecycle/queue `71 passed`, Python compile, dan `git diff --check`; optimized build sukses. Frontend production memakai `main.913b9202.js` (`sha256:898e7a4e9e67c4316b1cc29404796c4f6d046dc0844178c8330fbd60225bc503`) dan `main.ede365d9.css` (`sha256:b4d0bd8e985277fd4c4c8bcaa72f64e0d2535366b7ed9e2916031508106c6f81`); hash publik/lokal cocok. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261027T071314Z-before-fader-meter`. Backend PID `1783764`, online, unstable restarts `0`; API lokal/publik, homepage, dan visual route HTTP `200`; Nginx valid. Active customer/all builds tetap `0` sebelum dan sesudah deployment.
- Native/compiler dan worker Windows/macOS belum diubah atau disinkronkan untuk fitur meter fader ini.

Delta native final terbaru setelah pengguna mengizinkan sinkronisasi:

- Compiler/runtime native Windows/macOS sekarang mempertahankan target `groupIndex` pada seluruh modul Tuning. Tuning sampler aktif meng-override Tuning Master untuk grup tersebut; bila modul sampler di-bypass, grup kembali memakai Master. Wave Generator tetap memakai Master. Jalur sample biasa dan tempo-sync memakai nilai target yang sama tanpa penjumlahan ganda, sementara automation/preset/state tetap melalui binding `module_id` yang sudah ada.
- Manifest native membawa `fader_meter_enabled`, posisi, warna, gap, lebar, dan tinggi. Renderer Windows/macOS menggambar meter mono live di dalam bounding box Fader, memakai peak gabungan Master untuk fader global dan peak grup untuk fader bertarget sampler, dengan attack/release elapsed-time. Overlay juga berlaku pada atlas shared-preview, child Panel Mixer, skin CSS/filmstrip, Pitch Bend, dan Modulation.
- Dua guard build HTTP `503` khusus Tuning per sampler dan meter Fader sudah dilepas. Setelah smoke macOS sukses, `VST_MACOS_SAMPLER_ROUTING_ENABLED=true`; pipeline revision production dinaikkan menjadi `sampler-tuning-fader-meter-v1` agar artifact runtime lama tidak digunakan kembali.
- Tes fokus terbaru hijau: native compiler/runtime/capture `115 passed`; backend build-spec/lifecycle/queue `71 passed`; Python compile dan `git diff --check` bersih. Frontend tidak diubah sehingga tes/build frontend tidak diulang.
- Commit selektif `7fab2bcb420e44ba84c5a3bddf257c9b9ef528cb` (`Add sampler tuning and native fader meters`) sudah dipush dan sama dengan `origin/main`. Windows smoke run `40476098924` sukses; artifact `12721146910`, digest `sha256:1a72873f73855346a4f3e079e8c46b41a80255638b785c5443665c3d06590fa6`. macOS Universal smoke run `40476103433` sukses; artifact `12721525553`, digest `sha256:36cb2bce27a3b8b75adc85b68d3a757d5220bff8ee40f4c51fd54faefa870880`.
- Worker Windows di-overlay terbatas pada `NativeInstrument.cpp/.h`, `NativeView.cpp/.h`, dan `compile_manifest.py`; seluruh hash SHA-256 remote cocok. Backup rollback: `C:\TripleSideWorker\backups\tuning-fader-meter-before-20261027T085312Z`. Task kembali `Running`, tepat satu worker PID `4240`, jobs `0`.
- Backend production direstart pada PID `1792519`, status `online`, unstable restarts `0`; API lokal/publik dan visual route HTTP `200`, Nginx valid, log setelah restart tanpa error aplikasi, worker poll kembali `204`. Dispatcher macOS `enabled/active`, workflow aktif `0`, dan active customer/all builds tetap `0` sebelum/sesudah. Tidak ada build/job/artifact pelanggan atau data pelanggan yang dibuat/diubah.

Regresi hasil build sudah diperbaiki dan disinkronkan:

- Readout angka knob/fader kini digambar native secara dinamis saat hover/drag pada atlas maupun fallback Windows/macOS; format Tuning, Fine Tune, Pan, dB Input/Output, dan persen Fader mengikuti preview. Atlas memang sebelumnya menangkap readout dalam keadaan non-hover sehingga angkanya hilang di DAW.
- Wheel Windows kini memprioritaskan hit-test child Panel Mixer sebelum kontrol root, sama seperti double-click; ini memperbaiki fader child yang sebelumnya tidak menerima scroll.
- Capture browser kini menyimpan bounding box track meter bawaan Fader. Runtime Windows/macOS memakai geometri terukur itu, mempertahankan track statis dari atlas, menghapus border berwarna tambahan, memakai inset `1 px`, serta menggambar gradient warna level yang sama dengan preview.
- Solo/Mute sampler native kini saling eksklusif pada klik UI, automation audio-state, preset, dan state restore: menyalakan Mute mematikan Solo target yang sama, menyalakan Solo lebih dahulu mematikan Mute, Mute menang bila state lama berisi keduanya, sedangkan beberapa sampler tetap boleh Solo bersamaan.
- Tes fokus native compiler/runtime/capture/visual-manifest lulus `122 passed`; koreksi import macOS berikutnya lulus runtime focus `55 passed`; Python compile dan `git diff --check` bersih. Commit utama `fc40181504361ab95b10a3e06e564764b9db6134` (`Fix native control interaction parity`) dan koreksi namespace macOS `f9493671ba86b2da3b8db3835396d4578ca6f6d2` (`Fix macOS native view symbol imports`) sudah dipush; `HEAD` sama dengan `origin/main`.
- Windows smoke run `40484630482` sukses termasuk installer/uninstaller; artifact `12723784398`, digest `sha256:d4dd7299e1b62ce4636770fc12059e77b99658e4a7e21176a233aa9f8f90d4ba`. macOS smoke pertama menemukan dua import namespace yang kurang dan tidak menghasilkan artifact; setelah koreksi, run `40485033214` sukses termasuk installer/uninstaller; artifact `12723969885`, digest `sha256:3fa04a7b17de60abfa0d4d2f97d1e9e72275853fd98c6c33c91b8c2b246237a5`.
- Worker Windows di-overlay terbatas pada `NativeInstrument.cpp`, `NativeView.cpp/.h`, dan `render_visual_assets.py`; seluruh hash remote cocok dengan VPS: `e1f03a13...c918b1`, `fb03d7b0...275ae0`, `a5fb0186...0f86f7ce`, dan `527ce387...21dc65`. Backup rollback: `C:\TripleSideWorker\backups\control-parity-before-20261027T100349Z`. Task kembali `Running`, tepat satu proses PowerShell PID `1164`, jobs `0`.
- Pipeline revision production dinaikkan menjadi `native-control-parity-v1`; backend PM2 PID `1798803`, online, unstable restarts `0`. API lokal/publik dan visual route HTTP `200`, Nginx valid, dispatcher macOS `enabled/active`, workflow aktif `0`, serta active customer/all builds `0`. Tidak ada build/job/artifact atau data pelanggan yang dibuat/diubah.

Delta UI admin terbaru yang sudah di-deploy:

- Tab `Settings · Build & lisensi` sekarang tetap tampil untuk seluruh project admin, termasuk Plugin FX. Plugin FX tetap tidak menampilkan tab Mapping; customer tetap tidak mendapat tab Settings admin.
- Tes frontend fokus `VstMakerPreview.mixerBindings.test.jsx` dan `VstMakerPreview.templateEditing.test.js` lulus `63 passed`; `git diff --check` bersih dan optimized build sukses.
- Frontend production memakai `main.8061c99d.js` (`sha256:53a23cf2e0cea9219d707144e8bb956eb377e30d9f0447c54aa7cd8dfa58bab8`) dan `main.6adc8eed.css` (`sha256:ad6b38c43740fc36078f0d9b44961ce7100eadd4d73a61dc44dbd77061e54292`); hash publik/lokal cocok, homepage dan `/admin/vst-maker` HTTP `200`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261027T105253Z-before-admin-settings`.
- Pengguna kemudian mengizinkan penyelesaian penuh delta berikutnya.

Delta koreksi hasil build terbaru yang sudah selesai dan disinkronkan:

- Fader CSS/capture tidak lagi memiliki dead zone visual di ujung 0/100: thumb sekarang bergerak pada setiap perubahan nilai. Atlas fader menangkap meter kosong sehingga warna meter live native tidak lagi terbakar ke frame dan ikut bergerak bersama nilai fader.
- Wheel knob `Tuning` Windows/macOS sekarang snap tepat satu semitone per langkah wheel, termasuk child Panel Mixer; kontrol lain mempertahankan langkah lama.
- Tes frontend fokus lulus `50 passed`; tiga suite native fokus lulus `118 passed` secara keseluruhan; `git diff --check` bersih dan optimized frontend build sukses.
- Frontend production memakai `main.315fb292.js` (`sha256:1d8026abc66e0a10f16d3dcd63e982afaaac842091e64bb539d25f4f6f8a2965`) dan `main.c8e765ee.css` (`sha256:1040ca5b243464612425d6c56cd55e614c3b2739f4c3a7f533974289f7aa9ca1`); hash publik/lokal cocok, homepage dan visual route HTTP `200`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261027T110912Z-before-fader-wheel-fix`.
- Commit selektif native `226ea397127d58a77e34a378fcbf574a6e1b3c34` (`Fix native tuning wheel steps`) sudah dipush dan sama dengan `origin/main`. Windows smoke run `40494069821` sukses termasuk installer/uninstaller; artifact `12729437402`, digest `sha256:06941bd918ef8d8633e065593cb80ce47519a0777a04e3f3678ea6f440ff781c`. macOS Universal run `40494073603` sukses termasuk installer/uninstaller; artifact `12729137639`, digest `sha256:ff55c3bd3c007e282d729cb44e54d13e7a9c58830ab4658ea451049bc82d7f99`.
- Worker Windows di-overlay terbatas hanya pada `NativeView.cpp`; hash remote/lokal cocok `785b27a7...b1733e`, backup rollback `C:\TripleSideWorker\backups\tuning-wheel-before-20261027T111420Z`, task `Running`, satu proses PID `5964`, jobs `0`. Dispatcher macOS timer `enabled/active` dan workflow aktif `0`.
- Pipeline revision production dinaikkan menjadi `fader-meter-tuning-wheel-v1`; backend PID `1805336`, online, unstable restarts `0`. API lokal/publik, homepage, dan visual route HTTP `200`; Nginx valid; active customer/all builds `0`. Tidak ada build/job/artifact atau data pelanggan yang dibuat/diubah.
- Langkah berikutnya tunggal: tunggu pengguna membuat build baru melalui alur normal dan memeriksa fader, meter fader, serta wheel Tuning di DAW; jangan membuat build pelanggan atas inisiatif agen.

Delta Combo Box internal/editor terbaru—selesai; aux dikembalikan stereo:

- Popup `Combo Box Multiple Output` native Windows/macOS tidak lagi memakai menu OS (`TrackPopupMenu`/`NSMenu`). Popup sekarang digambar di dalam plugin dengan gaya gelap/aksen yang konsisten, pilihan `Master`/`OutN`, klik pilihan langsung menutup, klik ulang pada kontrol yang sama menutup tanpa memindahkan popup, dan klik luar menutup lalu meneruskan interaksi.
- Eksperimen bus aux mono terbukti mempersempit stereo image dan dapat menyebabkan phase cancellation pada rack/FX stereo. Sesuai keputusan pengguna, Master dan seluruh aux sampler sudah dikembalikan ke stereo penuh tanpa downmix; popup internal baru tetap dipertahankan.
- Ikon drag `⠿` di pojok kiri atas bounding box komponen editor sudah dihapus; drag komponen tetap bekerja dari container yang sama.
- Tes fokus terakhir hijau: frontend dua suite `63 passed`, native tiga suite `118 passed`, dan `git diff --check` bersih. Optimized frontend staging sukses; smoke admin staging dan production sama-sama merender Designer, menambahkan kontrol nyata, memastikan ikon `⠿`/`.maker-canvas-control__drag-mark` berjumlah `0`, root terisi, serta console/runtime/request error `0`.
- Frontend production memakai `main.8b4f074b.js` (`sha256:e6bff41ef3bb7803b66ed7ca6cdccbf90879862c29d00e5027a32a7daff1ce1a`) dan `main.c79003e5.css` (`sha256:0900399dc66bc90b01f160aa72409e98f6a6029f816416feeaef2536c823bab3`); hash publik/lokal cocok, homepage dan `/admin/vst-maker` HTTP `200`, Nginx valid. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261027T1134Z-before-output-popup`. Active customer/all builds tetap `0` sebelum swap.
- Popup internal awal di-commit pada `6aa67e3f927459f5e1a235abbda94bc0daf8ae74`. Follow-up stereo selektif di-commit/push sebagai `d7b7391f9e0c14dd79e0b25e9209b87f0ada357d` (`Restore stereo sampler aux outputs`); `HEAD` sama dengan `origin/main`. Tes native fokus tetap `118 passed` dan `git diff --check` bersih.
- Smoke follow-up stereo sukses: Windows run `40503404258`, artifact `12733174481`, digest `sha256:7aec3cad93e643573789939519f04dfcc44573787f9cc118f3eb995240158847`; macOS Universal run `40503408919`, artifact `12733448711`, digest `sha256:f0f9a50eee8791a1f204f17e6306166a4dcc29f812932cb92a7c0d90c46bc9eb`.
- Worker Windows dioverlay ulang terbatas hanya pada `NativeInstrument.cpp`; hash remote/lokal kembali cocok `e1f03a13...c918b1`. Backup rollback: `C:\TripleSideWorker\backups\stereo-aux-restore-before-20261027T1230Z`. Task `Running`, tepat satu worker PID `5824`, jobs `0`.
- Pipeline revision production sekarang `stereo-output-popup-v1`. Backend PID `1813202`, online, unstable restarts `0`; API lokal/publik sehat, Nginx valid. Dispatcher macOS `enabled/active`, workflow customer aktif `0`, serta active customer/all builds tetap `0`. Tidak ada build/job/artifact pelanggan dibuat.
- Langkah berikutnya tunggal: pengguna membuat build VST baru melalui alur normal, memasangnya, lalu me-rescan plugin atau membuka instance baru di DAW untuk memeriksa popup internal dan kualitas aux stereo; jangan membuat build pelanggan atas inisiatif agen.

Delta frontend-first komponen gabungan Solo + Mute terbaru:

- Designer sekarang memiliki komponen `Solo + Mute` berupa satu bounding box dengan dua tombol yang selalu menarget sampler yang sama. Inspector menyediakan jarak horizontal `0–48 px`, warna aktif Solo dan Mute terpisah, serta bentuk `Kotak`, `Kapsul`, atau `Bulat`.
- Klik Solo/Mute memakai aturan sampler yang sudah ada: keduanya saling eksklusif pada target yang sama, beberapa sampler tetap boleh Solo bersamaan, dan Mute tetap menang. Save/reload serta build spec mempertahankan `solo_mute_gap`, `solo_color`, `mute_color`, `button_shape`, dan `sampler_group_id`.
- Frontend fokus lulus `64 passed`; backend build-spec/lifecycle/queue lulus `74 passed`; Python compile dan `git diff --check` bersih. Optimized build staging sukses. Smoke browser staging dan production memverifikasi Mute aktif → klik Solo menghasilkan Solo aktif/Mute mati, bentuk kapsul, gap `13 px`, dua warna khusus, root terisi, serta console/page/request error `0`.
- Frontend production memakai `main.7e822023.js` (`sha256:b0058aa40b41e1e8e67858b6cd9acada807d889d417373a3ab5ced26213e43aa`) dan `main.1780d78e.css` (`sha256:8fcbc2c989ba4ed17f48977c92460834ca1f1b97a50982e3dc9119e08f21d36d`); hash publik/lokal cocok. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T040925Z-before-solo-mute-pair`.
- Backend production PID `3900`, status `online`, unstable restarts `0`; API lokal/publik, homepage, `/admin/vst-maker`, dan `/vst-visual-render` HTTP `200`; Nginx valid. Active customer/all builds tetap `0` sebelum dan sesudah deployment. Tidak ada build/job/artifact pelanggan atau data pelanggan yang dibuat/diubah.
- Runtime/compiler native Windows/macOS belum diubah atau disinkronkan. Build Windows/macOS yang memakai komponen `solo_mute` ditolak aman dengan HTTP `503` sebelum job dibuat.
- Pengguna sempat menyetujui hasil awal, tetapi kemudian secara eksplisit meminta **jangan sinkronkan dulu** agar perubahan lanjutan dapat dicoba. Instruksi terbaru ini menang: native/compiler, commit/push, worker Windows, builder macOS, guard build, dan pipeline revision tetap tidak disentuh.

Delta frontend dialog Ganti Komponen terbaru:

- Dialog `Ganti Komponen` sekarang selalu menampilkan seluruh kategori komponen yang tersedia. Ketika dibuka, tab awal otomatis mengikuti kategori komponen yang sedang diganti, tetapi pengguna dapat berpindah kategori dan mengganti jenis komponen lintas kategori.
- Konversi lintas kategori mempertahankan identitas/posisi/label yang aman, memakai ukuran serta default perilaku jenis baru bila jenis berubah, membawa target sampler bila kompatibel, dan melepaskan child Panel Button bila container diganti menjadi jenis non-panel. Thumbnail Solo/Mute juga sudah memakai markup non-interaktif yang valid di dalam kartu galeri.
- Tes frontend fokus tiga suite lulus `97 passed`; sesudah koreksi markup thumbnail, suite terkait lulus ulang `20 passed`. `git diff --check` bersih dan optimized staging build sukses.
- Smoke browser staging dan production memverifikasi tab awal `Fader`, seluruh `14` kategori tersedia, perpindahan ke kategori `Solo + Mute` serta penggantian komponen berhasil, root terisi, dan console/page/request error `0`.
- Frontend production memakai `main.1756b9b2.js` (`sha256:648d7197c8b8b1ee4e25626f80ed757c5a052cf00f86bba2f26c7472baa70236`) dan `main.1780d78e.css` (`sha256:8fcbc2c989ba4ed17f48977c92460834ca1f1b97a50982e3dc9119e08f21d36d`); hash publik/lokal cocok. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T0427Z-before-replace-categories`.
- Backend tetap PID `3900`, online, unstable restart `0`; homepage dan `/admin/vst-maker` HTTP `200`, Nginx valid, serta active customer/all builds tetap `0` sebelum/sesudah deployment. Tidak ada build/job/artifact pelanggan atau data pelanggan yang dibuat/diubah.
- Langkah berikutnya tunggal: tunggu pengguna mencoba dialog penggantian komponen dan Solo/Mute di production. Jangan melakukan sinkronisasi native/compiler, commit/push, smoke workflow, atau overlay worker sampai pengguna memberi persetujuan eksplisit baru.

Delta preservasi setting pengganti dan kalibrasi Wing terbaru:

- Penggantian komponen sekarang mempertahankan binding yang kompatibel, termasuk `moduleId`, parameter modul, nilai, ukuran, target sampler, posisi, serta pengaturan visual/jenis yang sudah ada. Default jenis baru hanya dipakai untuk field yang memang belum dimiliki kontrol. Binding wajib khusus seperti `solo_mute`/Output tetap dinormalisasi agar build spec tidak menjadi invalid.
- Auto-binding Prism pada penggantian ke Spectrum tidak lagi menimpa target modul lama; Prism baru hanya dibuat bila kontrol pengganti belum memiliki target modul.
- Lima filmstrip Wing (`Crimson Wing`, `Black Crimson Wing`, `Regent White Wing`, `Black Crimson Wing · Ring`, dan `Black Crimson Wing · Dots`) sekarang mengompensasi kuantisasi filmstrip 64-frame. Sebelumnya Pan tengah memilih frame ke-32 yang berada `+2,142857°` melewati jam 12; koreksi dinamis membuat sudut efektif tepat `0°` sambil mempertahankan gerak kontinu pada nilai lain.
- Dua suite frontend fokus lulus `67 passed`; `git diff --check` bersih dan optimized staging build sukses.
- Smoke staging dan production membuktikan Fader bertarget `tone-module`/parameter `tone` tetap membawa binding, nilai, serta ukuran `91×207 px` setelah diganti menjadi Crimson Wing. Koreksi midpoint terukur `-2,142857°`, sehingga sudut efektif pusat sekitar `4e-15°` (nol secara visual), dengan root terisi dan console/page/request error `0`.
- Frontend production memakai `main.9bb3c156.js` (`sha256:020e9fca2325eaf10c937c96423486054e82034525156b56ed15789e70f486fa`) dan `main.82fa6c2a.css` (`sha256:515a0d4fa1efa3d57882023e55074f9d00eeabfe142f68de6a93565c6dce5bc0`); hash publik/lokal cocok. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261028T0442Z-before-replace-settings-wing-center`.
- Active customer/all builds tetap `0` sebelum/sesudah deployment. Native/compiler, backend, pipeline revision, worker Windows/macOS, commit/push, build/job/artifact pelanggan, serta data pelanggan tidak diubah.
- Pengguna kemudian memberi persetujuan eksplisit untuk sinkronisasi native penuh.

Delta sinkronisasi native Solo + Mute final:

- Compiler native sekarang menerima `solo_mute`, mempertahankan `samplerGroupIndex`, gap `0–48`, warna aktif Solo/Mute terpisah, serta bentuk `square`/`capsule`/`round` dalam `ControlInfo`.
- Runtime Windows dan macOS menggambar pasangan tombol dinamis di atas atlas maupun fallback/panel child. Tombol kiri langsung mengontrol slot Solo grup (`3`), tombol kanan slot Mute (`2`); klik men-toggle, double-click mereset sisi yang dipilih, dan aturan saling eksklusif tetap ditangani parameter grup native yang sudah ada.
- Guard HTTP `503` sementara untuk `solo_mute` sudah dilepas dan warning automation palsu `solo_mute` dikecualikan. Pipeline revision production dinaikkan menjadi `solo-mute-pair-v1`.
- Tes fokus final hijau: native compiler/runtime/capture `120 passed`, backend build-spec/lifecycle/queue `74 passed`, Python compile dan `git diff --check` bersih.
- Commit selektif `255ba419f280c7fff2954f42736f7344fd9613cd` (`Add native combined solo mute control`) sudah dipush dan sama dengan `origin/main`; hanya enam file native/compiler/test terkait yang ikut commit.
- Windows smoke run `40635685276` sukses termasuk installer/uninstaller; artifact `12792824272`, digest `sha256:4a1cd9a0d19ae98c871f3a998aefc5744426e1b8dd298777ee333ab39fa162e0`. macOS Universal run `40635685102` sukses termasuk arm64 + Intel/install/uninstall; artifact `12793033972`, digest `sha256:cb2dcede01b16c894b27f5c9b6bfe6e30bcbc2bef8e0b9da1e08506207a9cd67`.
- Worker Windows di-overlay terbatas pada `NativeView.cpp`, `NativeView.h`, dan `compile_manifest.py`; hash remote cocok dengan VPS: `b9a35fea...21ee`, `617500ed...7f4e`, `06e8f1eb...13fc`. Backup rollback: `C:\TripleSideWorker\backups\solo-mute-pair-before-20261028T050702Z`. Task `Running`, tepat satu proses PID `4732`, jobs `0`.
- Worker macOS customer memakai checkout `main`; dispatcher timer tetap enabled/active dan workflow customer aktif `0`. Backend production PID `10123`, online, unstable restart `0`; API lokal/publik, visual route, dan Nginx sehat.
- Audit akhir active customer/all builds `0`. Tidak ada build/job/artifact pelanggan atau data pelanggan yang dibuat/diubah.
- Langkah berikutnya tunggal: pengguna membuat build baru melalui alur normal dan memeriksa pasangan Solo/Mute di DAW; jangan membuat build pelanggan atas inisiatif agen.

Permintaan lanjutan yang masih belum dikerjakan:

- Langkah berikutnya tunggal: tunggu pengguna membuat build baru melalui alur normal dan memeriksa readout angka, wheel Fader, visual meter, serta Solo/Mute di DAW; jangan membuat build pelanggan atas inisiatif agen.
- Record terbaru `092b3d46-6e53-44bf-b5c8-2ecfb272bce2` diperbarui secara CAS pada `2026-10-27T03:48:00.166372+00:00`: channel Kick/Snare dipisah, label fader dipendekkan, label meter dikosongkan, dan dua Combo Box diperlebar. Record legacy tidak diubah. Active builds `0` dan tidak ada presence owner aktif saat mutasi.

Hal penting yang sudah diselesaikan:

- Frontend mengikat knob/fader/button/Solo/Mute, pad/keyboard, indicator, meter/spectrum/waveform/bar/vectorscope, dan Combo Box Output ke sampler target. Combo Box hanya berisi `Master` serta `Output terpisah · [sampler target]`, dengan nilai stabil `0/100`.
- Preview browser memiliki analyser dan jalur monitoring terpisah per sampler. Perubahan target membaca nilai sampler baru secara langsung; penghapusan sampler membersihkan binding dan mengembalikan output dengan aman.
- Save/reload sekarang mempertahankan `sampler_group_id`. Bug terakhir yang ditemukan adalah migrasi Prism EQ menambahkan kembali `moduleId` ke Spectrum bertarget sampler; ini sudah diperbaiki dengan mengecualikan analyser sampler dari auto-binding Prism.
- Label `""`, termasuk `off_label` dan `on_label`, dipertahankan. Tes round-trip nyata mencakup knob, fader, button, meter, spectrum, Combo Box, child Panel Mixer, Text, serta fallback satu kali untuk project legacy tanpa field label.
- Backend memvalidasi kompatibilitas binding, menolak ID sampler yatim dan konflik module/sampler, serta menormalkan build spec. Compiler/runtime Windows/macOS membawa indeks sampler, monitoring group, note targeting, automation/state output biner, dan dua pilihan output lokal.
- Compiler memisahkan keberadaan bus fisik dari routing default: sampler yang ditargetkan Combo Box tetap mendapat bus aux walaupun default-nya `Master`, sedangkan nilai awal tetap mengikuti `output_bus`.
- Audit diff menemukan dan memperbaiki dua celah terakhir: label kosong tidak lagi membuat status `Panel & binding` gagal, dan label pilihan Output native Windows/macOS sekarang konsisten menampilkan `Output terpisah · [sampler]` baik pada nilai terpilih maupun menu.
- Delta audit hanya menyentuh `frontend/src/pages/VstMakerPreview.jsx`, `frontend/src/pages/VstMakerPreview.mixerBindings.test.jsx`, `native-vst3/Source/NativeView.cpp`, `native-vst3/Source/NativeViewMac.mm`, dan `native-vst3/tests/test_runtime_source_contract.py`.

Verifikasi terakhir yang sudah hijau:

```bash
# Frontend fokus setelah perbaikan reload/Prism terakhir
cd /home/triplesidestudio/tripleside/frontend
CI=true npm test -- --runInBand \
  src/pages/VstMakerPreview.mixerBindings.test.jsx \
  src/pages/VstMakerPreview.templateEditing.test.js
# 45 passed

# Backend fokus
cd /home/triplesidestudio/tripleside
PYTHONPATH=backend backend/venv/bin/python3 -m pytest -q \
  backend/tests/test_vst_maker_build_spec.py \
  backend/tests/test_vst_maker_project_lifecycle.py
# 50 passed

# Native fokus, termasuk source contract Windows/macOS
backend/venv/bin/python3 -m pytest -q \
  native-vst3/tests/test_compile_manifest.py \
  native-vst3/tests/test_runtime_source_contract.py \
  native-vst3/tests/test_visual_capture_resilience.py
# 112 passed
```

Gerbang final:

- Frontend penuh `238 passed` setelah memperbarui dua assertion source-contract Wave Generator agar mengenali argumen target sampler baru.
- Backend lokal/non-mutating `338 passed`. Tujuh file integration lama yang memakai `requests` tidak diarahkan ke production karena melakukan CRUD; run mentahnya memakai host preview lama/BASE_URL kosong dan menghasilkan 404/MissingSchema, bukan kegagalan kode lokal.
- Native penuh `150 passed`.
- Optimized frontend build staging sukses; `git diff --check` bersih.

Smoke browser production nyata pada `/vst-visual-render` lulus: HTTP `200`, fader Snare membaca `64`, Combo Box Snare tepat dua opsi `Master`/`Output terpisah · Snare` walaupun Kick dan Hat memakai output terpisah, label Text kosong tidak dirender, dan console/page error `0`.

Deployment final:

- Native commit `1d3bd2033a012f4c155cbc5395ef7acd440b0e61` (`Bind native controls to sampler groups`) sudah dipush ke `origin/main`; index Git bersih, perubahan frontend/backend terkait tetap berada di dirty worktree yang disengaja dan tidak ikut ter-stage luas.
- Windows smoke run `40408372623` sukses termasuk build/install/uninstall; artifact `12692646283`, digest `sha256:21b743439eb586c5b32d96cdb6db321e74c6ae0c35ee0cc29e3cf3d5837d80c4`.
- macOS Universal smoke run `40408377526` sukses termasuk arm64 + Intel/install/uninstall; artifact `12690488998`, digest `sha256:ae0f5272fdb98077e102c02931dc2b243f8941c33557b909e31a249613fbaf52`.
- Worker Windows di-overlay hanya tujuh source terkait; seluruh SHA-256 cocok. Backup rollback: `C:\TripleSideWorker\backups\sampler-bindings-before-20261026T215910Z`. Kondisi akhir: task `Running`, tepat satu proses worker, jobs `0`.
- Frontend production memakai `main.37dd8c6f.js` (`sha256:8ff3117603b6dfeb5d869c1e017bd64c8ffc6d2cde46f64b5a439dcb48d1c140`) dan `main.a11169f5.css` (`sha256:1a1c6d55dcd5086e162c7c420f714a421e0599be9e082857551d648ebcbe8f29`); hash publik/lokal cocok. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T220001Z-before-sampler-bindings`.
- Backend PM2 direstart dan sehat: status `online`, unstable restarts `0`; API lokal/publik, homepage, dan route visual semuanya HTTP `200`; Nginx valid. Active customer builds tetap `0` sebelum dan setelah deployment.

Tepat satu langkah berikutnya: tunggu pengguna memeriksa hasil VST pada build berikutnya yang mereka buat melalui alur normal; jangan membuat build pelanggan atas inisiatif agen.

## SPESIFIKASI TUGAS ASLI — gunakan sebagai checklist audit, jangan mulai ulang

### Ruang lingkup dan acceptance criteria

Kerjakan ini sebagai koreksi arsitektur end-to-end, bukan patch tampilan saja. Pertahankan semua perubahan pengguna/worktree yang sudah ada, jangan reset/clean, jangan membuat job/build pelanggan, dan jangan commit/push tanpa izin eksplisit. Mulai dari kode production terbaru lalu ikuti satu sumber kebenaran: `sampler_group_id` menentukan sampler target/sumber sebuah komponen.

1. Semua komponen yang mempunyai perilaku audio harus dapat memilih `Master plugin` atau sampler tertentu melalui inspector dan binding itu harus bekerja identik di preview browser, save/load project, preset/automation, build spec, compiler, serta runtime native Windows/macOS:
   - kontrol nilai: knob, fader, button, Solo, Mute;
   - pemicu nada: pad dan keyboard bila komponen tersebut memang mengirim note;
   - pembaca status: indicator bila sumbernya berasal dari parameter sampler;
   - monitoring: Gain Meter, VU Meter, seluruh Spectrum, waveform, bar spectrum, vectorscope, dan correlation meter;
   - Combo Box Output.
   Komponen dekoratif/layout murni (`text`, `image`, scale/ring visual tanpa data, dan tombol pembuka panel) tidak perlu diberi target palsu. Panel Mixer hanya menjadi container; child control di dalamnya tetap memakai binding masing-masing.

2. Jangan membatasi dropdown sampler hanya karena parameter awal komponen masih `tone`/`visual`. Saat sampler dipilih, tampilkan hanya parameter yang kompatibel dengan jenis komponen dan sinkronkan nilai langsung dari sampler target. Volume membaca/menulis `group.volume`, Pan membaca/menulis `group.pan`, Mute/Solo membaca/menulis boolean sampler. Double-click harus menetralkan target yang benar: Volume `100`, Pan tengah `0` (`50` pada nilai UI ternormalisasi), Mute/Solo `false`. Mengganti target Sampler 1 ke Sampler 2 harus segera mengganti nilai yang tampil tanpa memakai nilai stale milik sampler lama.

3. Meter dan visual audio wajib mempunyai pilihan `Sumber monitoring`: `Master plugin` atau satu sampler. Browser harus menyediakan analyser terpisah per sampler dari jalur audio sampler tersebut, bukan memakai `meterAnalyserRef` master untuk semuanya. Native harus menyediakan peak/RMS/sample analysis per group dan memilihnya berdasarkan target group control; Master tetap memakai output gabungan. Pastikan meter/spectrum Sampler 1 tidak bergerak ketika hanya Sampler 2 berbunyi, dan sebaliknya. Gain-reduction meter yang terikat ke modul DSP tetap mengikuti modulnya; jangan menimpa binding DSP dengan sampler secara ambigu.

4. Ubah Combo Box Output menjadi pilihan lokal dua item, bukan daftar global semua sampler/output:
   - jika komponen ditargetkan ke Sampler 2, isi Combo Box hanya `Master` dan `Sampler 2` (boleh berlabel `Output terpisah · Sampler 2`);
   - Sampler 1, Sampler 3, dan sampler lain tidak boleh muncul pada Combo Box tersebut;
   - target lain baru muncul setelah `Sampler target` komponen diganti;
   - gunakan semantik stabil `0 = Master`, `100 = output terpisah milik sampler target`, jangan lagi menghitung indeks berdasarkan jumlah/urutan semua output terpisah;
   - rename sampler langsung memperbarui label, menghapus sampler target mengembalikan binding dengan aman ke Master/unbound, dan perubahan routing dari Mixer Sampler langsung tercermin di Combo Box;
   - compiler/native `StringListParameter`, visual capture/atlas, preset/state, dan automation juga harus persis dua pilihan tersebut. Jangan hanya memfilter elemen `<option>` di browser.

5. Normalisasi dan validasi `sampler_group_id` secara konsisten di frontend, backend, dan compiler untuk seluruh jenis komponen yang didukung. Tolak ID yatim pada build spec, tetapi migrasikan project lama tanpa binding ke Master. Jangan izinkan `module_id` dan `sampler_group_id` aktif bersamaan bila maknanya bertabrakan. Pastikan capture override (`captureLevel`) tetap deterministik dan tidak merusak visual verifier.

6. Perbaiki persistence label seluruh komponen. String kosong `label: ""` adalah pilihan pengguna yang sah dan berarti **jangan tampilkan label**; jangan menganggapnya sebagai nilai hilang. Akar masalah yang sudah teridentifikasi ada pada `controlLabelOrFallback()` / `controlsWithDefaultLabels()` dan pemanggilannya saat save di `frontend/src/pages/VstMakerPreview.jsx`: save saat ini mengubah label kosong kembali menjadi label parameter/jenis komponen. Hapus mutasi default pada jalur save. Default label hanya boleh diberikan sekali ketika komponen baru dibuat atau ketika field label benar-benar `undefined`/`null` pada migrasi project lama—gunakan pemeriksaan nullish/keberadaan properti, bukan `label || fallback`, `trim() || fallback`, atau truthy check. Pertahankan `""` tanpa perubahan dalam state editor, undo/redo, duplicate/replace skin, payload API, database, reload, preset/template, build spec, visual capture, compiler, dan runtime native Windows/macOS. Renderer browser/native tidak boleh menggambar fallback visual ketika label kosong; fallback tetap boleh dipakai hanya untuk `aria-label`, tooltip editor, atau nama internal agar aksesibilitas tidak hilang. Audit juga jalur komponen `text` yang masih merender `control.label || "Text"`: teks yang sengaja dikosongkan harus tetap kosong setelah save/reload. `off_label` dan `on_label` harus mengikuti aturan yang sama secara independen—nilai kosong eksplisit tidak boleh diisi ulang.

### Acceptance test minimum

Gunakan satu fixture kecil berisi `Sampler 1` dan `Sampler 2`; jangan memakai/mengubah project pelanggan. Wajib buktikan:

- fader Volume, knob Pan, Mute, dan Solo yang ditargetkan ke Sampler 2 membaca nilai awal Sampler 2, mengubah hanya Sampler 2, mengikuti perubahan dari Mixer/preset, serta reset double-click ke nilai netral yang benar;
- meter dan setiap keluarga visual analyzer bertarget Sampler 1 hanya bereaksi terhadap audio Sampler 1; versi Master bereaksi terhadap gabungan;
- Combo Box bertarget Sampler 2 memiliki tepat dua opsi `Master` dan `Sampler 2`, tetap dua opsi walaupun Sampler 1/3 memakai output terpisah, serta round-trip browser → payload → build spec → manifest → native mempertahankan target dan routing;
- pindah target, rename, hapus sampler, save/reload, preset, dan automation tidak meninggalkan nilai/label dari target lama;
- Panel Mixer dengan kontrol bawaan disembunyikan tetap dapat memakai child fader/meter/spectrum yang terikat ke sampler.
- untuk sedikitnya knob, fader, button, meter, spectrum, Combo Box, panel child, dan komponen Text: hapus label sampai string kosong, save, reload, duplicate, ganti skin, buat build spec/manifest, lalu pastikan label tetap `""` dan tidak dirender. Project legacy yang benar-benar tidak memiliki field `label` tetap mendapat default satu kali. Tambahkan tes DOM/round-trip nyata; assertion source string saja tidak cukup.

### Jalur tes hemat waktu/kuota

Jangan menjalankan seluruh suite pada setiap edit. Urutan yang dianjurkan:

```bash
# 1. Selama iterasi: tes frontend yang paling dekat saja
cd /home/triplesidestudio/tripleside/frontend
CI=true npm test -- --runInBand src/pages/VstMakerPreview.mixerBindings.test.jsx src/pages/VstMakerPreview.templateEditing.test.js

# 2. Setelah UI/serialisasi stabil: kontrak backend terkait saja
cd /home/triplesidestudio/tripleside
PYTHONPATH=backend backend/venv/bin/python3 -m pytest -q \
  backend/tests/test_vst_maker_build_spec.py \
  backend/tests/test_vst_maker_project_lifecycle.py

# 3. Setelah manifest/runtime stabil: native fokus saja
backend/venv/bin/python3 -m pytest -q \
  native-vst3/tests/test_compile_manifest.py \
  native-vst3/tests/test_runtime_source_contract.py \
  native-vst3/tests/test_visual_capture_resilience.py

# 4. Pemeriksaan murah setiap batch
git diff --check
PYTHONPATH=backend backend/venv/bin/python3 -m py_compile \
  backend/routers/vst_maker.py native-vst3/tools/compile_manifest.py
```

Tambahkan tes perilaku/DOM nyata ke file fokus di atas; jangan hanya `source.toContain`. Setelah semua tes fokus hijau, lakukan satu smoke browser dengan fixture dua sampler untuk memeriksa opsi Combo Box dan isolasi analyser. Jalankan full frontend/backend/native suite **hanya sekali** sesaat sebelum deployment, lalu optimized frontend build sekali. Sebelum restart/deploy/overlay worker, pastikan active builds dan worker jobs `0`; setelah deploy cocokkan hash publik/lokal dan lakukan satu smoke produksi. Jika source native macOS belum dapat disinkronkan karena belum ada izin commit/push, pertahankan guard yang menolak hanya fitur baru tersebut dan catat dengan jelas—jangan menghasilkan artifact yang salah.

## DEPLOYED 2026-10-26 — fastfix target sampler fader dan Combo Box

- Fader/knob baru sekarang selalu menampilkan pilihan `Target kontrol` (`Master plugin`, Sampler 1, Sampler 2, dst.) walaupun parameter awalnya masih `Tone`. Memilih sampler otomatis mengubah fader/knob biasa menjadi `Volume`; skin pan otomatis menjadi `Pan`, sedangkan Solo/Mute tetap memakai fungsi masing-masing.
- Inspector Combo Box Output sekarang memisahkan dua hal yang sebelumnya membingungkan: `Sampler target` menentukan sampler yang dikendalikan, sedangkan `Output awal · [sampler]` menentukan apakah Combo Box mulai pada `Master` atau `Output terpisah · [sampler]`. Mengubah output awal langsung menyinkronkan routing sampler dan nilai Combo Box.
- Audit read-only pada project terbaru membuktikan target Combo Box kedua sudah benar menuju Snare, tetapi routing Snare masih `Master`; karena itu tampilan `Master` sebelumnya memang berasal dari routing otoritatif, bukan salah membaca target. UI baru membuat keduanya dapat dilihat dan diubah dari inspector yang sama.
- Tes fokus frontend lulus `44 passed`, `git diff --check` bersih, dan optimized build sukses. Frontend production memakai `main.99a0a30b.js` (`sha256:ad87c7ca4c829a3dbb8988ab3ba2f9b90e215162d4ad3451ae92b3a42b5de8b6`) serta `main.a11169f5.css`; hash JS publik/lokal cocok. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T165715Z-before-mixer-target-fastfix`.
- Sebelum/sesudah swap active builds `0`, API publik `200`. Backend, worker, dispatcher, job, build, artifact, entitlement, kuota, dan data pelanggan tidak diubah. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — binding Mixer per sampler dan kontrol bawaan dapat diganti

- Double-click slider `VOL`/`PAN` pada popup Panel Mixer browser kembali bekerja: volume kembali ke `100` dan pan ke tengah `0`. Jalur native Windows/macOS tetap memakai reset yang sama; kontrol Volume sampler custom juga sekarang kembali ke unity, bukan `50%`.
- Knob, fader, Button, Solo, dan Mute dapat ditargetkan ke `Master plugin` atau sampler tertentu melalui inspector. Binding `sampler_group_id` membaca nilai Volume/Pan/Mute/Solo otoritatif dari sampler, ikut berubah saat Mixer Sampler/preset berubah, menulis kembali ke sampler saat komponen digerakkan, persisten dalam project/build spec, serta dikompilasi menjadi parameter native `group_N_volume|pan|mute|solo`.
- Combo Box Multiple Output tidak lagi menampilkan `control.value` lama ketika sampler target diganti. Preview menghitung pilihan dari routing sampler target; jalur capture tetap dapat memaksa frame atlas per bus sehingga verifier visual tidak diregresikan.
- Panel Mixer memiliki opsi `Kontrol bawaan Mixer`: mode default lama tetap tampil untuk kompatibilitas, atau dapat disembunyikan agar pengguna memasang child knob/fader/Solo/Mute sendiri. Child controls dapat dihapus dan diganti skin melalui mekanisme Designer yang sudah ada. Pilihan `mixer_show_default_controls` persisten dan dihormati browser, capture, compiler, Windows, serta macOS.
- Regresi lulus: frontend penuh `237 passed` termasuk interaksi DOM baru, backend VST terkait `186 passed` ditambah fokus akhir `56 passed`, native penuh `147 passed`, Python compile, `git diff --check`, dan optimized production build. Browser production `/vst-visual-render` membuktikan Snare Volume `64`, Kick Pan `30` (pan `-0,4`), Snare Mute aktif, Combo Box Snare `Master`, kontrol default tersembunyi, root terisi, serta console/runtime error `0`.
- Frontend production memakai `main.f51925c3.js` (`sha256:4adc9f669afdfd5b468925d71ca6cc5e16afc8cba93428998321929238a664c7`) dan `main.a11169f5.css` (`sha256:1a1c6d55dcd5086e162c7c420f714a421e0599be9e082857551d648ebcbe8f29`); hash publik/lokal cocok. Backup rollback frontend: `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T164325Z-before-mixer-sampler-bindings`.
- Backend direstart setelah active builds `0`; PM2 PID `1711939`, status `online`, unstable restart `0`, API lokal/publik sehat, Nginx valid, dan pipeline revision `mixer-sampler-bindings-v1`. Worker Windows dioverlay terbatas pada `NativeView.cpp` serta `compile_manifest.py`; hash remote/lokal cocok `4b7cd488...17c3` dan `1f189614...27b1`. Backup rollback worker: `C:\TripleSideWorker\backups\mixer-sampler-bindings-before-20261026T164325Z`; task kembali `Running`, satu proses, jobs `0`.
- Dispatcher macOS tetap `enabled/active` dan tidak diubah. Karena source belum di-commit/push, guard macOS tetap menolak lebih awal hanya build yang memakai multiple output, DSP per sampler, kontrol per sampler, atau Panel Mixer tanpa kontrol bawaan sampai worker GitHub tersinkron; build legacy tetap tersedia. Audit akhir active customer/all builds `0`; tidak ada job, build, artifact, entitlement, kuota, atau data pelanggan yang dibuat maupun diubah. Source belum di-commit/push.

## AUDIT SELESAI 2026-10-26 — penutupan Combo Box Multiple Output

- Audit read-only setelah deployment memastikan backend PM2 tetap `online` pada PID `1701260` dengan unstable restart `0`, API lokal/publik sehat, Nginx valid, dan log error setelah restart tidak memuat `ERROR`, `CRITICAL`, traceback, atau exception aplikasi.
- Production tetap memuat `main.96afaa85.js` dan `main.a11169f5.css`; SHA-256 publik sama dengan file lokal dan catatan deployment: JS `9c750439ccd2e4196345bb8299c83ef104c30b6d11e960e38034ab5541f20d7c`, CSS `1a1c6d55dcd5086e162c7c420f714a421e0599be9e082857551d648ebcbe8f29`.
- Regresi fokus penutup lulus: frontend layout/template `72 passed`, backend build spec/queue `52 passed`, native compiler/runtime/capture `107 passed`, serta `git diff --check` bersih.
- Worker Windows tetap `Running`, tepat satu proses aktual, jobs `0`. Dispatcher macOS berada di user systemd scope dan tetap `enabled/active`; polling selesai normal tanpa workflow yang dibuat.
- Audit akhir tetap menunjukkan active customer builds `0` dan seluruh active builds `0`. Tidak ada redeploy, restart, job, build, artifact, entitlement, kuota, data pelanggan, atau worker source yang diubah. Source tetap belum di-commit/push sesuai aturan pengguna; pekerjaan fitur dinyatakan selesai.

## DEPLOYED 2026-10-26 — Combo Box Multiple Output responsif, warna, dan ukuran teks

- Combo Box Multiple Output sekarang benar-benar mengikuti lebar dan tinggi bounding box. Isi `<select>` memakai sisa tinggi komponen secara fleksibel, sementara header/label, gap, padding, radius, dan ukuran teks ikut berskala menggunakan container query. Pada ukuran ekstrem `90 x 48 px`, pilihan `Master`, `Kick`, dan `Hi-Hat` tetap terlihat; teks tidak lagi terpotong lalu menghilang.
- Inspector memiliki binding `Warna combo box`, `Warna teks pilihan`, serta slider `Ukuran teks pilihan` `6–32 px`. Nilai baru persisten sebagai `control_color`, `text_color`, dan `output_font_size`, dinormalisasi frontend/backend, ikut ke immutable build spec, visual renderer, atlas per bus, compiler, serta fallback native Windows/macOS. Ukuran yang dipilih otomatis dibatasi oleh ruang aktual agar tetap aman saat komponen diperkecil.
- Regresi baru mencakup resize vertikal, serialisasi visual, warna/font build contract, compiler manifest, dan runtime fallback. Verifikasi lulus: frontend penuh CI `234 passed`, backend VST terkait `169 passed` ditambah fokus schema/build `126 passed`, native penuh `145 passed`, native fokus `107 passed`, Python compile, fixture JSON, `git diff --check`, dan optimized production build.
- Capture live dari `https://triplesidestudio.com/vst-visual-render` menghasilkan atlas `3` frame (`Master`, `Kick`, `Hi-Hat`) dengan tinggi `118 px`, background `#1A2233`, teks `#DDEEFF`, dan font `17 px`. Verifier lulus `99,954569%` idle dan `99,954993%` active. Production memuat `main.96afaa85.js` (`sha256:9c750439...1f20d7c`) dan `main.a11169f5.css` (`sha256:1a1c6d55...be8f29`); hash publik/lokal cocok.
- Backend direstart setelah active builds `0`; PM2 PID `1701260`, status `online`, unstable restart `0`, API lokal/publik sehat, dan Nginx valid. Worker Windows dioverlay terbatas pada `NativeView.cpp` serta `compile_manifest.py`; hash remote/lokal cocok `98592cc9...1bb370f` dan `db60debd...a0936fd`. Backup rollback worker: `C:\TripleSideWorker\backups\combo-output-style-before-20261026T143919Z`; task kembali `Running`, satu proses, jobs `0`.
- Dispatcher macOS tetap enabled/active dan tidak diubah. Source belum di-commit/push sesuai aturan pengguna; guard routing macOS tetap dipertahankan sampai ada izin eksplisit commit/push dan worker GitHub tersinkron. Tidak ada job, build, artifact, kuota, entitlement, atau data pelanggan yang dibuat maupun diubah.

## DEPLOYED 2026-10-26 — Combo Box Multiple Output diselesaikan

- Komponen Designer sekarang tampil jelas sebagai kategori `Multiple Output` dengan pilihan `Combo Box Output`. Setiap instance diikat ke satu sampler; daftar runtime berisi `Master` ditambah seluruh bus sampler yang diaktifkan sebagai `Output terpisah`. Nilai awal selalu disinkronkan dari routing Mixer Sampler saat target, status output, atau daftar sampler berubah, termasuk setelah sampler dihapus.
- Akar pekerjaan yang sebelumnya belum selesai ada pada pipeline visual: `output_selector` belum terdaftar sebagai kontrol yang didukung, renderer build belum menormalkan `output_bus`, dan atlas tidak memiliki frame per bus. Capture sekarang membuat tepat satu frame untuk setiap pilihan bus. Fixture tiga bus menghasilkan `Master`, `Kick`, `Hi-Hat`, manifest `frames: 3`, parameter native `group_0_output`, dan verifier lulus `99,998726%` idle serta `99,999151%` active.
- Build spec backend menormalkan nilai awal Combo Box secara otoritatif dari sampler target. Plugin effect tidak menawarkan komponen sampler-only ini dan backend menolaknya lebih awal. Guard macOS juga mencakup Combo Box walaupun seluruh output masih default ke Master, sehingga worker macOS lama tidak mungkin menerima spec yang belum didukung.
- Runtime/automation/state yang sudah disiapkan sebelumnya dikunci oleh regresi: parameter memakai `StringListParameter`, perubahan Combo Box merutekan group ke bus yang dipilih, state v7 menyimpan routing, user/factory preset dapat mengendalikan parameter melalui control binding, Windows memakai popup bus bernama, dan macOS memakai menu yang sama. Capture shared-preview kini memberi Windows/macOS atlas dinamis yang identik dengan browser, termasuk saat Combo Box ditempatkan sebagai child Panel Button.
- Verifikasi lulus: frontend penuh `233 passed`, backend VST terkait `188 passed`, native penuh `145 passed`, tes fokus final backend `52 passed`, native `107 passed`, Python compile, JSON fixture, `git diff --check`, dan optimized staging build. Browser production authenticated-simulasi menambahkan Combo Box nyata, melihat opsi `Master/Kick`, default `Kick`, helper inspector tampil, root terisi, bundle benar, serta console/runtime/request error `0`.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1697373`, status `online`, unstable restart `0`, API lokal/publik sehat, Nginx valid, dan log setelah restart tanpa error aplikasi. Frontend dipasang melalui swap atomik memakai `main.0366a334.js` (`sha256:308019ec42a87e6f14195745924ba928127acbd168927b5cbc58e173da7f8661`) serta `main.4851d38a.css` (`sha256:99a44e7f1e3595dff9defd6bc85a9bbe2d975bd5ba5b3771ea8462bcdd5c4d44`); hash publik/lokal cocok. Backup rollback frontend: `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T1414Z-before-output-selector`.
- Worker Windows dioverlay terbatas hanya pada `native-vst3/tools/render_visual_assets.py` setelah active builds dan jobs `0`; hash remote/lokal cocok `b48c5a57...22c69`. Backup rollback: `C:\TripleSideWorker\backups\output-selector-before-20261026T141227Z`. Worker kembali `Running`, satu proses PID `5716`, jobs `0`.
- Dispatcher macOS tetap enabled/active dan tidak diubah. Source macOS/fitur masih belum di-commit/push sesuai aturan pengguna, sehingga guard `VST_MACOS_SAMPLER_ROUTING_ENABLED=false` tetap dipertahankan sampai ada izin eksplisit commit/push dan worker GitHub tersinkron. Tidak ada job, build, artifact, entitlement, kuota, atau data pelanggan yang dibuat maupun diubah.

## DEPLOYED 2026-10-26 — multiple output bernama sampler dan DSP per sampler

- Setiap kartu Mixer Sampler sekarang memiliki dropdown `Output DAW`: `Master` atau `Output terpisah · [nama sampler]`. Nama bus tidak disimpan ganda; compiler selalu mengambil nama sampler terbaru, sehingga rename sampler otomatis mengganti nama output build berikutnya.
- Setiap modul DSP dapat diarahkan ke `DSP Master` atau `DSP · [nama sampler]`. Save/load browser dan API mempertahankan `output_bus` serta `sampler_group_id`; project lama tetap default ke Master, target yatim ditolak backend, dan menghapus sampler mengembalikan modul terkait ke Master.
- Preview browser memakai satu AudioWorklet graph per sampler dan merangkainya sebagai `DSP sampler → DSP Master → analyser`. Dua sampler berbeda tidak lagi mengganti singleton rack atau membocorkan modul sampler ke semua suara.
- Native memisahkan voice per group, memproses rack sampler sebelum routing, dan mengirim group secara eksklusif ke Master atau auxiliary bus agar tidak terdengar ganda. Rack Master hanya memproses group yang menuju Master; tail rack sampler tetap diproses saat input voice sudah diam. Buffer bus nonaktif, silence flags, license mute, analysis gabungan, automation/preset, compressor meter, dan custom cabinet IR sudah mengikuti rack yang benar.
- Regresi lulus: backend VST terkait `187 passed`, frontend penuh `232 passed`, native penuh `143 passed`, Python compile, JSON fixture, dan `git diff --check`. Tes fokus tambahan mencakup project legacy satu output, daftar bus `Master/Kick/Hi-Hat`, rack index DSP per sampler, output eksklusif, graph preview browser terisolasi, serta guard sinkronisasi macOS.
- Optimized build staging lulus. Browser staging authenticated-simulasi membuktikan rename `Sampler 1 → Kick` memperbarui opsi menjadi `Output terpisah · Kick`, pilihan `separate` aktif, dan target DSP menampilkan `DSP Master` serta `DSP · Kick`; runtime/console/request error `0`.
- Worker Windows dioverlay terbatas pada `NativeInstrument.cpp/.h` dan `compile_manifest.py` setelah active builds serta jobs `0`. Hash remote/lokal cocok: `29e41cea...bafc`, `e6c7a71c...9c1`, `7d8fa055...4cd`. Backup rollback: `C:\TripleSideWorker\backups\multi-output-dsp-before-20261026T104530Z`.
- Smoke internal Windows memakai fixture `TripleSide Multi Output Smoke`: MSVC 19.44 sukses, validator membaca `3 Out(s)` berurutan `Master` (Main), `Kick` (Aux), `Hi-Hat` (Aux), bus activation/arrangement lulus, dan hasil akhir `47 passed, 0 failed`. Installer/uninstaller lulus tanpa residu. Artifact internal `23.432.333` byte, `sha256:8bca0c34bdb04f2edaffbacfd60429e4b6c2f3a9d3f1adbdd50f36425a764025`. Worker kembali `Running`, satu PID `2112`, jobs `0`.
- Pipeline revision production dinaikkan menjadi `multi-output-sampler-dsp-v1`; backend direstart setelah active builds `0`. PM2 PID `1683904`, status `online`, unstable restart `0`; API lokal/publik sehat, Nginx valid, log sejak restart tanpa error, dan worker poll kembali `204 No Content`.
- Frontend dipasang melalui swap atomik. Production memakai `main.7d7fffef.js` (`sha256:825d317ce4bff36f4124faf4025c5ad8ede3ffd8152d342baffcd25db88fa431`) dan `main.c8ecc677.css` (`sha256:ff24dfba47001d3325eb53b1b62fcb8ef71e7bf87c9c6c9aa6140d026d876b6d`); worklet v13 publik/lokal cocok `sha256:9166e8cf37f2aee1c83b1e368045addc7d05ce289b8b31444eda90ac92664e91`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T1129Z-before-multi-output-dsp`.
- Browser production authenticated-simulasi mendapat HTTP `200`, memuat bundle baru, memverifikasi output bernama dan target DSP sampler, root terisi, serta runtime/console/request error `0`. Audit akhir active customer/all builds `0`; tidak ada job/build/artifact/data pelanggan yang dibuat atau diubah.
- Batasan: source belum di-commit/push sesuai aturan pengguna. Dispatcher macOS tetap enabled/active, tetapi worker macOS masih checkout GitHub `main` lama; compile/deploy native macOS untuk fitur ini tertunda sampai ada perintah eksplisit commit/push. Selama itu backend menolak lebih awal hanya build macOS yang memakai output terpisah atau DSP per sampler dengan HTTP `503`, sebelum job/kuota dibuat, sehingga worker lama tidak dapat menghasilkan artifact yang salah. Build macOS legacy tetap tersedia; guard baru dibuka melalui `VST_MACOS_SAMPLER_ROUTING_ENABLED=true` setelah worker tersinkron. Artifact lama tetap immutable.

## DEPLOYED 2026-10-26 — tombol Buka VST Studio memakai merah tema

- Tombol `Buka VST Studio` pada CTA paling bawah halaman paket diubah dari putih menjadi merah utama TripleSide `#e11d48`, teks putih, hover `#be123c`, dan shadow merah lembut.
- Tes pricing `3 passed`, optimized staging build sukses, dan browser staging/production mengukur background `rgb(225, 29, 72)`, teks putih, HTTP `200`, serta console/runtime error `0`.
- Frontend production memakai `main.f58cc93b.js` (`sha256:5b7ac43a98babafbe7fec5e97695450037d76600008ecebf3b80416efb3f9437`) dan `main.a4a72d82.css`; hash JS publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T1018Z-before-red-vst-cta`.
- Active builds sebelum deployment `0`. Backend, worker, dispatcher, paket, harga, job, build, artifact, entitlement, dan data pelanggan tidak diubah. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — Studio Commercial mendukung tiga plugin dan copy paket diperjelas

- Creator Commercial tetap untuk `1 plugin komersial` dengan `12 build total` dalam satu pool. Studio Commercial sekarang mendukung maksimal `3 plugin komersial` dengan `24 build total` dalam satu pool bersama dan `1.000 serial per plugin + API`. Setiap artifact Windows atau macOS tetap memakai satu kuota build.
- Binding entitlement sekarang memakai `bound_project_ids` dengan batas project otoritatif dari definisi paket. Field legacy `bound_project_id` tetap dibaca dan dinormalisasi, sehingga entitlement lama kompatibel; pengikatan slot baru dilakukan atomik dan menolak project keempat Studio maupun project kedua Creator Commercial. Hak Studio lama otomatis mengikuti batas tiga project tanpa migrasi destruktif.
- Dashboard billing menghitung slot plugin yang masih tersedia, bukan sekadar jumlah entitlement yang belum memiliki satu `bound_project_id`. Simulasi Studio dengan dua project terikat menampilkan `1 slot plugin` tersisa.
- Kartu, tabel perbandingan, admin grant, serta deskripsi produk diperjelas dengan jumlah plugin dan pool build. Label tabel sekarang `PERBANDINGAN PAKET` dengan judul `Pilih paket sesuai kebutuhan Anda`; copy lama `Hak yang jelas sejak awal` dihapus.
- Audit sebelum deployment menemukan active customer/all builds `0`, satu entitlement Creator Commercial aktif, dan entitlement Studio aktif `0`; tidak ada entitlement pelanggan yang dimutasi. Ekspresi slot diuji langsung secara read-only pada MongoDB: binding legacy project pertama plus array project kedua mengizinkan project ketiga dan menolak project keempat.
- Verifikasi lulus: backend VST penuh `190 passed`, frontend penuh `228 passed`, tes fokus final backend `24 passed`, frontend pricing `3 passed`, Python compile, `git diff --check`, optimized staging build, serta browser smoke staging authenticated-simulasi.
- Backend direstart setelah active builds `0`; PM2 PID `1673421`, status `online`, unstable restart `0`, API lokal/publik sehat, Nginx valid, metadata produk tersinkron, dan log error setelah restart bersih.
- Frontend dipasang melalui swap atomik. Production memakai `main.df669384.js` (`sha256:2072d2408dcca160b7ecdaa6e664a86f9ef85cef72be19f2163b9ab85500af45`) dan `main.a4a72d82.css` (`sha256:826921e753f8f8e8b85ce4fccbcc1d71e711baaa5116e7bd4b6e47b4bbdcee60`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T1005Z-before-studio-three-plugins`.
- Browser smoke production IDR/USD mendapat HTTP `200`, bundle baru termuat, copy Creator/Studio dan judul tabel benar, simulasi customer menghitung satu slot Studio tersisa, serta console/runtime/request error `0`. Audit akhir active customer/all builds `0`; worker, dispatcher, job, build, artifact, dan data pelanggan tidak diubah. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — harga paket otomatis IDR/USD berdasarkan negara

- Halaman paket tidak lagi memaksa query `currency=IDR`. Backend memakai deteksi negara yang sudah ada: Indonesia mendapat IDR, negara lain mendapat USD; preferensi manual `ts_display_currency` yang pernah dipilih pengguna tetap mengalahkan deteksi otomatis.
- Harga IDR tetap menjadi nilai otoritatif dan tidak diganti. Katalog menambahkan `display_price`, `display_normal_price`, serta `display_first_purchase_discount` hasil konversi server dengan kurs USD/IDR yang sama seperti infrastruktur checkout. Katalog personalized setelah login menggunakan jalur lokalisasi yang sama, sehingga mata uang tidak kembali ke IDR saat data customer selesai dimuat.
- Promo Personal ikut dikonversi konsisten, termasuk harga coret. Pada kurs production saat verifikasi `18.065 IDR/USD` dari Frankfurter, Personal tampil `$8.25 → $5.54`, Creator `$16.55`, Creator Commercial `$41.46`, dan Studio Commercial `$137.84`. Indonesia tetap melihat `Rp149.000 → Rp100.000`, `Rp299.000`, `Rp749.000`, serta `Rp2.490.000`; format Rupiah tanpa spasi dipertahankan.
- Verifikasi lulus: backend fokus `30 passed`, frontend pricing `3 passed`, Python compile, `git diff --check`, optimized staging build, direct catalog test ID/US, dan browser smoke staging IDR/USD. Nilai dasar IDR tetap tidak berubah saat nilai tampilan USD ditambahkan.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1667099`, status `online`, unstable restart `0`, API lokal/publik sehat, Nginx valid, dan log error setelah restart bersih.
- Frontend dipasang melalui swap atomik. Production memakai `main.ad628b88.js` (`sha256:3821ef51e8d8515cf8af37d1688d214171d7906dda4e049c8ff4a7d9fba9e847`) dan `main.a4a72d82.css` (`sha256:826921e753f8f8e8b85ce4fccbcc1d71e711baaa5116e7bd4b6e47b4bbdcee60`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T0848Z-before-package-usd-conversion`.
- Browser smoke production mendapat HTTP `200`, root terisi, bundle baru termuat, mode otomatis Indonesia menampilkan Rupiah, override USD menampilkan nominal dolar hasil kurs, serta console/runtime/request error `0`. Audit akhir active customer/all builds `0`; worker, dispatcher, job, build, artifact, entitlement, dan data pelanggan tidak diubah. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — keterangan harga spesial pembelian pertama Personal

- Kartu Personal yang eligible promo sekarang menampilkan teks `Harga spesial untuk pembelian paket pertama Anda` tepat di bawah nominal Rp100.000. Copy hanya dirender oleh kondisi diskon Personal yang sama dengan harga coret, sehingga tidak muncul pada pembeli lama maupun paket Creator/Commercial/Studio.
- Tampilan memakai font `10 px`, bobot `600`, line-height ringkas, dan emerald dengan opacity `90%` agar informatif tetapi tetap berada di bawah hierarki nominal harga. Browser staging mengukur teks benar-benar berada setelah batas bawah Rp100.000; Creator Commercial dan Studio Commercial masing-masing memiliki copy promo `0`.
- Tes pricing `3 passed`, `git diff --check`, dan optimized staging build sukses. Browser smoke staging serta production mendapat root terisi, posisi copy benar, jumlah copy tepat `1`, serta console/runtime/request error `0`.
- Frontend dipasang melalui swap atomik. Production memakai `main.995717e6.js` (`sha256:6a0fcae758fba00de7cbb3672e9e810de0c7fc34e0aecafa2b7af690343152a7`) dan `main.a4a72d82.css` (`sha256:826921e753f8f8e8b85ce4fccbcc1d71e711baaa5116e7bd4b6e47b4bbdcee60`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T0829Z-before-personal-first-price-copy`.
- Audit sebelum/sesudah deployment active customer/all builds `0`. Backend, worker, dispatcher, checkout, harga, produk, job, build, artifact, entitlement, dan data pelanggan tidak diubah pada koreksi copy frontend ini. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — diskon visual storefront hanya untuk pembelian pertama Personal

- Akar harga coret Creator Commercial dan Studio Commercial adalah metadata katalog lama: `normal_price` masih `999.000`/`2.990.000` sementara `price` sudah `749.000`/`2.490.000`; komponen kartu memperlakukan setiap selisih tersebut sebagai diskon. Baseline Personal juga masih membawa pembanding lama `299.000` terhadap `149.000`.
- Harga normal Personal sekarang `149.000`, Creator `299.000`, Creator Commercial `749.000`, dan Studio Commercial `2.490.000`, sama dengan harga jual standarnya. Hanya respons Personal yang eligible untuk pembelian paket VST pertama menerima `first_purchase_discount=49.000`, `normal_price=149.000`, dan `price=100.000`. Frontend juga mensyaratkan ID Personal serta marker promo tersebut sebelum menampilkan harga coret/label hemat, sehingga payload legacy paket lain tidak dapat memunculkan diskon visual.
- Verifikasi lulus: backend fokus `19 passed`, frontend pricing `3 passed`, Python compile, `git diff --check`, optimized staging build, dan browser smoke staging dengan payload legacy. Backend lokal/publik mengembalikan Personal `149.000 → 100.000`, Creator Commercial `749.000 = 749.000`, dan Studio Commercial `2.490.000 = 2.490.000`; metadata empat produk production juga cocok.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1662912`, status `online`, unstable restart `0`, API lokal/publik sehat, Nginx valid, dan log error setelah restart bersih.
- Frontend dipasang melalui swap atomik. Production memakai `main.367c093f.js` (`sha256:ebe24dff55aa3b7f76b26acad2bb61575111a50037237fc4eabe934088433cea`) dan `main.04e2d3ed.css` (`sha256:ba101b10054b5ca4068f72dbc01e80f0d15091d8a5c3045ad9537732c0599a8f`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T0808Z-before-commercial-price-fix`.
- Browser smoke production mendapat HTTP `200`, root terisi, Personal memiliki tepat satu harga coret `Rp149.000` di atas `Rp100.000`, Creator Commercial hanya `Rp749.000`, Studio Commercial hanya `Rp2.490.000`, dan console/runtime/request error `0`. Audit akhir active customer/all builds `0`; worker, dispatcher, job, build, artifact, entitlement, dan data pelanggan tidak diubah. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — harga coret promo Personal diperbesar dan disusun vertikal

- Harga standar Personal `Rp149.000` sekarang tampil dicoret dengan ukuran yang sama persis seperti harga promo, lalu `Rp100.000` berada tepat di bawahnya. Keduanya memakai computed font `30 px`; harga lama memiliki `text-decoration: line-through` dan posisi vertikalnya terukur di atas harga baru.
- Tes fokus pricing `3 passed` dan optimized staging build sukses. Browser smoke production mendapat HTTP `200`, root terisi, kedua harga berukuran `30 px`, susunan lama-di-atas-baru benar, dan console/runtime error `0`.
- Frontend dipasang lewat swap atomik. Production memakai `main.338eb74c.js` (`sha256:e901af9874d0a450ed3c6d2f285bc5a52ce285812747a4e52f8277e8dced55a0`) dan `main.04e2d3ed.css` (`sha256:ba101b10054b5ca4068f72dbc01e80f0d15091d8a5c3045ad9537732c0599a8f`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T035936Z-before-personal-price-visibility`.
- Active customer/all builds sebelum deployment `0`. Backend, worker, dispatcher, checkout, harga otoritatif, job, build, artifact, entitlement, dan data pelanggan tidak diubah pada koreksi visual ini. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — diskon pembelian pertama Personal dan tombol Export diperjelas

- Customer yang belum pernah menyelesaikan pembelian paket VST mendapat diskon otomatis Rp49.000 saat membeli Personal sebagai paket pertamanya. Harga otoritatif checkout menjadi Rp100.000 dari harga standar Rp149.000; riwayat transaksi berstatus `paid` untuk paket VST mana pun menutup kelayakan promo berikutnya. Coupon/discount lain tidak ditumpuk dan jalur checkout memilih potongan terbesar.
- Katalog publik menampilkan Rp149.000 dicoret dan Rp100.000 sebagai harga utama. Setelah login, katalog dipersonalisasi dari riwayat pembayaran customer sehingga pembeli lama kembali melihat harga Personal standar.
- Label `Build sesuai paket` di samping Export dihapus. Tombol Export diperlebar secara horizontal menjadi padding `1,3rem`, sedangkan menu pilihan Windows/macOS tetap selebar `15,5rem` dan isinya tidak berubah.
- Verifikasi lulus: backend fokus `19 passed`, frontend fokus final `34 passed`, Python compile, dan `git diff --check`. Pemeriksaan pricing langsung read-only pada database production menghasilkan `fresh_personal_final=100000` dan `discount=49000`.
- Optimized frontend staging sukses. Browser smoke production pricing mendapat HTTP `200`, root terisi, kartu Personal memuat Rp100.000 dan Rp149.000, serta console/runtime error `0`.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1635055`, status `online`, unstable restart `0`, API lokal/publik sehat, Nginx valid, dan log error setelah restart bersih.
- Frontend dipasang melalui swap atomik. Production memakai `main.d52fa0ea.js` (`sha256:b96c713a3de43a800741c4bcd7e6fa4305ed72935f9fcf8b014bf6a15601caa2`) dan `main.29a376c9.css` (`sha256:a91f00ba04c4b3219a73b1708077bebbf0a2a1ce4f48e5755f19adf141f90d79`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T021503Z-before-first-personal`.
- Audit akhir active customer/all builds `0`. Worker, dispatcher, job, build, artifact, entitlement, serta data pelanggan tidak diubah. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — layout kartu paket tidak meluber dan label `/ plugin` dihapus

- Akar teks `Windows/macOS` menabrak batas adalah tiga kotak ringkasan pada setiap kartu kembali menjadi tiga kolom sempit di breakpoint `2xl`, sementara lima kartu paket sudah berbagi lebar halaman. Ringkasan build/platform/lisensi sekarang selalu satu kolom dan memiliki guard `min-width: 0` serta wrapping.
- Sufiks kecil `/ plugin` setelah nominal harga dihapus seluruhnya karena model paket sekarang sudah dijelaskan melalui kuota build dan label tersebut tidak menambah informasi yang berguna.
- Tes fokus pricing `3 passed`; optimized staging build sukses. Smoke staging dan production pada viewport `390`, `1440`, dan `1920 px` membuktikan seluruh empat label `Windows/macOS` berada di dalam kotak, page overflow `0`, `/ plugin` tidak ada, root terisi, bundle baru termuat, serta console/runtime/request error `0`.
- Frontend dipasang lewat swap atomik. Production memakai `main.adf5098e.js` (`sha256:ce3e0db46c0f8872f180a1f12074bbd765a00273cf24987ab0e5ca95a9263667`) dan `main.544b8e33.css` (`sha256:caa2ca413d679f7dbc81ce97267487156e5dcae0da8d4db0e6d8004c6ab24ff2`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T0116Z-before-plan-card-fix`.
- Active customer/all builds sebelum deployment `0`. Backend, worker, dispatcher, produk, harga, kuota, job, build, artifact, dan entitlement pelanggan tidak diubah pada hotfix frontend ini. Source belum di-commit/push.

## DEPLOYED 2026-10-26 — paket berbasis kuota build dan tombol Rebuild dihapus

- Paket aktif sekarang adalah Personal Rp149.000 dengan maksimal 1 build, Creator Rp299.000 dengan maksimal 3 build, Creator Commercial Rp749.000 dengan maksimal 12 build, serta Studio Commercial Rp2.490.000 dengan maksimal 24 build. Seluruh copy platform memakai istilah `Windows/macOS`; tidak ada lagi `Windows + macOS`, `Windows dan macOS`, atau `Windows atau macOS` pada storefront paket.
- ID internal paket komersial lama `creator` sengaja dipertahankan untuk `Creator Commercial` agar entitlement pelanggan lama tidak turun hak. Paket nonkomersial `Creator` baru memakai ID internal `creator_personal` dan produk `vst-business-creator-personal`.
- Setiap artifact Windows atau macOS memakai satu kuota. Reservasi kuota dilakukan atomik pada entitlement ketika job baru benar-benar dibuat; artifact identik yang digunakan ulang tidak memakai kuota, sedangkan job gagal/dibatalkan mengembalikan reservasi dan retry job gagal dapat memesan kembali slot. Paket tetap terikat ke satu project pada build pertama.
- Jalur `Rebuild Koreksi` tidak lagi dipakai. Tombol/menu Rebuild, panel kesempatan koreksi, parameter frontend `force_correction_rebuild`, dan copy masa koreksi dihapus. Export menjadi satu-satunya jalur build baru; tombol `Ulangi build` untuk job gagal/dibatalkan tetap tersedia dan bukan produk Rebuild terpisah.
- Creator/Studio lama tetap komersial dengan 100/1.000 serial dan akses Marketplace Direct. Personal serta Creator baru selalu satu perangkat per lisensi; kapasitas perangkat admin tetap berlaku untuk Creator Commercial, Studio Commercial, dan Partner.
- Verifikasi lulus: frontend penuh `228 passed`, backend VST terkait `190 passed`, Python compile, dan `git diff --check`. Optimized frontend staging sukses; smoke staging serta production memverifikasi lima kartu paket, harga/kuota baru, label Windows/macOS, tidak ada overflow, VST Studio hanya menampilkan Export tanpa Rebuild, root terisi, dan console/runtime/request error `0`.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1628170`, status `online`, unstable restart `0`. Startup meng-upsert empat produk published dengan harga baru, termasuk Creator baru; API katalog lokal/publik mengembalikan limit `1/3/12/24` dan sehat.
- Frontend dipasang melalui swap atomik. Production memakai `main.4cbe259a.js` (`sha256:669471635897e91768e939290cf7639b3361089dcec75724d091fb1bd7d4f1f2`) dan `main.ae52d8e6.css` (`sha256:55abf2bfc98b67fe5f5d0c758e82073e7a8d2f16b40a3447276a25143dfca211`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261026T0108Z-before-plan-quota`.
- Audit akhir: active customer/all builds `0`; satu entitlement Creator Commercial lama tetap aktif dan tidak dimutasi oleh deployment; Creator baru belum memiliki entitlement. Worker Windows tetap `Running`, tepat satu proses, jobs `0`; dispatcher macOS tetap enabled/active. Tidak ada job, build, artifact, atau entitlement pelanggan yang dibuat, dibatalkan, diulang, atau diubah. Source belum di-commit/push.

## DEPLOYED 2026-10-25 — batang tipis Bar Spectrum tetap pekat dengan pixel snapping

- Batang `Bar Spectrum Visualizer` pada preview browser, native Windows, dan native macOS sekarang disejajarkan ke piksel fisik layar. Slider `Ketebalan batang Bar Spectrum` tetap hanya mengubah lebar; warna serta opacity tidak dikompensasi atau diubah berdasarkan ketebalan. Minimum visual menjadi satu piksel fisik penuh sehingga batang tipis tidak lagi tampak pudar akibat cakupan subpiksel/antialiasing.
- Verifikasi matematika `4.320` kombinasi lebar, rasio, DPR, dan indeks batang menghasilkan `0` sisi pecahan piksel. Smoke staging dan production pada DPR `1,5` mengukur ketebalan `10% = 1 px` dan `100% = 13 px`; semua 48 batang memiliki sisi integral dan sampel RGBA identik `[56, 189, 248, 224]` pada kedua ketebalan, dengan console/runtime error `0`.
- Regresi lulus: frontend penuh `228 passed`, backend VST terkait `142 passed`, native penuh `141 passed`, optimized frontend staging build, serta `git diff --check`. Frontend production memakai `main.67834fd8.js` (`sha256:4b5426b0d08346c1a6ea767a33911d4be9b95bfd2b00b8056786ca9260cb8a4c`) dan `main.2f6395d7.css` (`sha256:b1b064f734675a87223c1b483fb50f474d11ae1b5dc2cc693c1f0bd5b0265286`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261025T184748Z-before-bar-pixel-snap`.
- Native di-commit dan dipush selektif ke `main` sebagai `5c36426` (`Pixel-align bar spectrum rendering`). Smoke Windows run `40222657143` dan macOS Universal run `40222659389` sukses termasuk build serta install/uninstall. Artifact Windows `12609922614`, digest `sha256:8f1e507713145ee03c9dc5bbb332548e200f4862a7b4d194d21cb7d31ae01eab`; artifact macOS `12610376265`, digest `sha256:48ec328f15787801d44bb470b7648ad3aa10abecc511e632b70bd7b14e0b82c7`.
- Worker Windows menerima overlay terbatas `NativeView.cpp` setelah active customer/all builds dan jobs `0`; hash remote/lokal cocok `d9ca3c49e13cbebccb2928c25009fad9b33f4c37bab3693364869d5810ccb716`. Backup rollback `C:\TripleSideWorker\backups\bar-spectrum-pixel-snap-before-20261025T184914Z`; task kembali `Running`, tepat satu wrapper PID `6044`, dan jobs `0`.
- Backend direstart setelah active builds `0`; PM2 PID `1603671`, status `online`, unstable restart `0`. Pipeline revision production menjadi `bar-spectrum-pixel-snap-v1`, API lokal/publik dan Nginx sehat, serta log error sesudah restart bersih. Workflow aktif `0` dan timer dispatcher macOS tetap aktif. Harga/paket, job, build, artifact, dan data pelanggan tidak diubah.

## DEPLOYED 2026-10-25 — ketebalan batang Bar Spectrum dapat diatur

- `Bar Spectrum Visualizer` sekarang memiliki kontrol persisten `Ketebalan batang Bar Spectrum` tepat di bawah judul inspector. Rentang `10–100%` mengubah rasio lebar setiap batang terhadap slot 48 band; default project lama tetap `54%`, sehingga tampilan lama tidak berubah sampai pengguna menggeser slider.
- Nilai `bar_width_ratio` mengalir melalui normalisasi/save-load frontend, schema dan build spec backend, visual capture, compiler manifest, serta renderer native Windows/macOS. Perhitungan rasio mengikuti resize komponen dan tetap mengizinkan batang tipis melalui minimum subpiksel `0,5 px`.
- Verifikasi lulus: frontend penuh `228 passed`; backend VST terkait `142 passed`; native penuh `141 passed`; Python compile dan `git diff --check` bersih. Browser staging mengukur slider visible pada `y=585 px`, persistensi `90%`, serta perubahan lebar rata-rata `1,32 px → 7,90 px` tanpa error.
- Native/compiler di-commit dan dipush selektif ke `main` sebagai `f7a523f` (`Add adjustable bar spectrum thickness`). Smoke Windows run `40220885398` dan macOS Universal run `40220888046` sukses, termasuk build serta install/uninstall. Artifact Windows `12609134574`, digest `sha256:c9c7d29c6485fae129d48a87b87ac284de5b6058e7c8ed1511dec59453dbc6c7`; artifact macOS `12608879471`, digest `sha256:03880d78bc55ca44c12dfeb2791147042fa80658a5f77bf1313fa9dfcf1a4419`.
- Worker Windows menerima overlay terbatas `NativeView.cpp/.h` dan `compile_manifest.py` setelah active builds dan jobs `0`. Hash remote cocok dengan VPS; backup rollback `C:\TripleSideWorker\backups\bar-spectrum-width-before-20261025T182543Z`. Task kembali `Running`, tepat satu wrapper PID `1696`, dan jobs `0`.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1600636`, status `online`, unstable restart `0`. Pipeline revision production menjadi `bar-spectrum-width-v1` agar artifact lama tidak digunakan ulang. API lokal/publik dan Nginx sehat; log sesudah restart tidak memiliki error aplikasi.
- Frontend dipasang melalui swap atomik. Production memakai `main.c372741e.js` (`sha256:6ffede4f332c85c6db6c80b8e267621f4e7e98af80fa17e5afc5951adbc7af21`) dan `main.2f6395d7.css` (`sha256:b1b064f734675a87223c1b483fb50f474d11ae1b5dc2cc693c1f0bd5b0265286`); hash JS publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261025T182332Z-before-bar-spectrum-width`.
- Browser smoke production authenticated-simulasi memverifikasi bundle baru, kontrol visible pada `y=585 px`, perubahan ketebalan `10% → 100%` benar-benar mengubah lebar batang sekitar `0,88 px → 8,78 px`, root terisi, dan error `0`. Audit akhir: active customer/all builds `0`, workflow aktif `0`, worker jobs `0`, dan dispatcher macOS tetap enabled/active. Harga/paket, job, build, artifact, dan data pelanggan tidak diubah.

## DEPLOYED 2026-10-25 — kontrol ketebalan Realtime Waveform dibuat langsung terlihat

- Laporan pengguna terkonfirmasi sebagai masalah discoverability, bukan bundle yang gagal terpasang: kontrol `Ketebalan garis` sebelumnya berada sekitar `y=983 px` pada viewport setinggi `1000 px`, jauh di bagian bawah inspector setelah seluruh kontrol umum.
- Kontrol sekarang dipindahkan ke kartu violet tepat di bawah judul `Pengaturan komponen terpilih` dan diberi label eksplisit `Ketebalan garis Realtime Waveform`. Slider lama di bagian bawah dihapus agar tidak ada dua sumber nilai.
- Frontend penuh `227 passed`, optimized staging build sukses, dan `git diff --check` bersih. Browser staging mengukur label pada `y=585 px`, mengubah nilai `3.2` menjadi `6.4 px`, serta mencatat runtime/console/request error `0`.
- Frontend dipasang melalui swap atomik. Production memakai `main.fb12b61f.js` (`sha256:508176e47dbdcaeafdaedc0445f2d2adf1032699e0096d89e8b79127b2f03a74`) dan `main.2f6395d7.css`; hash JS publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261025T1754Z-before-waveform-line-visible`.
- Browser smoke production terautentikasi membuktikan kontrol terlihat langsung pada `y=585 px`, perubahan ke `6.4 px` berhasil, bundle baru termuat, dan error `0`. API publik dan Nginx sehat; active customer/all builds tetap `0`. Backend, pipeline revision, worker, workflow native, job, build, artifact, dan data pelanggan tidak diubah pada hotfix ini.

## DEPLOYED 2026-10-25 — tuning knob, ketebalan waveform, dan scale Relative chord

- Indikator angka knob yang terhubung ke modul `Tuning & Fine Tune` sekarang memakai unit musikal yang sama dengan DSP: Tuning `-24..+24 st` dan Fine Tune `-100..+100 ct`, bukan angka mentah `0..100`. Jalur visual capture kini ikut menerima `engine_modules` dan `module_id`, sehingga sprite/native visual tidak kehilangan formatter tersebut; fallback kontrol native Windows juga memakai unit yang sama.
- Komponen `Realtime Waveform` memiliki properti persisten `waveform_line_width` dengan rentang `0.5..8 px`. Slider `Ketebalan garis` tersedia di inspector Spectrum, diterapkan pada preview canvas, tersimpan melalui schema/build spec, dikompilasi ke manifest native, dan digunakan oleh renderer Windows serta macOS.
- Pattern Lab pada Wave Generator memiliki scale baru `Relative · chord yang dimainkan` untuk Chord Generator, Arpeggiator, Bassline Generator, dan Melody Generator. Saat Live Trigger aktif, seluruh tuts yang sedang ditahan menjadi voicing sumber; root diambil dari nada terendah dan interval aktual dipertahankan, sehingga major, minor, maj7, min7, sus2, sus4, inversi, dan voicing arbitrer ikut terbaca. Pola diregenerasi ketika komposisi tuts berubah dan berhenti setelah semua tuts dilepas.
- Metadata event `relative_degree` dan flag manifest `relativeChord` menjaga perilaku yang sama di plugin native. Runtime native melacak semua note held, memetakan degree pola ke voicing chord saat ini, dan tetap mempertahankan perilaku transpose satu-root untuk scale lama.
- Verifikasi lulus: frontend penuh `227 passed`; backend VST terkait `142 passed`; native penuh `141 passed`; Python compile dan `git diff --check` bersih. Browser smoke pada build staging membuktikan `Tuning=+12 st`, `Fine Tune=-50 ct`, canvas menerima `waveform_line_width=5.5`, dan runtime/console error `0`.
- Native/compiler di-commit dan dipush selektif ke `main` sebagai `b315180` (`Add relative chord and waveform native parity`). Smoke internal Windows run `40217016944` dan macOS Universal run `40217017118` sukses pada commit tersebut, termasuk build serta install/uninstall. Artifact Windows `12608296903`, digest `sha256:63f8b1ac12edcd876248b742e57bd379fc407fa7ff0840efb3b440070593e333`; artifact macOS `12607553182`, digest `sha256:a7994680a39589229b5f91b1b2a8b95cc4fd4c2ecd9649b007ede34633e297ab`.
- Worker Windows menerima overlay terbatas enam file runtime/compiler setelah active builds dan jobs `0`. Semua SHA-256 remote cocok dengan VPS; backup rollback `C:\TripleSideWorker\backups\relative-chord-waveform-before-20261025T173054Z`. Task kembali `Running`, tepat satu wrapper PID `896`, dan jobs `0`.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1594935`, status `online`, unstable restart `0`. Pipeline revision production menjadi `relative-chord-waveform-v1` agar artifact lama tidak digunakan ulang. API lokal/publik dan Nginx sehat; log sesudah restart tidak memiliki error aplikasi dan poll worker kembali `204 No Content`.
- Frontend dipasang lewat swap atomik. Production memakai `main.31b061da.js` (`sha256:303bd2deb2a8c58638cc9cd8f44d18c500d083f52300737f7f6ddfeeda24b944`) dan `main.2f6395d7.css` (`sha256:b1b064f734675a87223c1b483fb50f474d11ae1b5dc2cc693c1f0bd5b0265286`); hash publik/lokal cocok. Backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261025T1734Z-before-relative-chord-waveform`.
- Browser smoke production authenticated memverifikasi Designer ter-render, bundle baru termuat, `Tuning=+12 st`, `Fine Tune=-50 ct`, scale `Relative` dapat dipilih, canvas menerima `waveform_line_width=5.5`, root terisi, serta runtime/console/request error `0`.
- Audit akhir: active customer builds `0`, seluruh active builds `0`, workflow aktif `0`, worker jobs `0`, dan dispatcher macOS tetap enabled/active. Tidak ada job/build/artifact pelanggan yang dibuat, diklaim, diulang, dibatalkan, atau diubah; source dirty/untracked lain tetap dipertahankan.

## SELESAI 2026-10-24 — resize Spectrum persisten dan transient mute/solo diperbaiki global

- Akar reset resize ada pada aturan minimum yang tidak konsisten: editor mengizinkan komponen Spectrum/Realtime Waveform sampai `48x48`, tetapi normalisasi frontend dan validator backend memaksa atau menolak ukuran di bawah `240x120`. Semua jalur sekarang memakai minimum `48x48`, sehingga posisi dan ukuran hasil resize tetap sama setelah disimpan dan dimuat ulang, termasuk pada Neon Pop Rock Drums serta project/template lain.
- Akar lonjakan suara sesudah mute lama ada di native sampler: group yang mute/non-solo dilewati sebelum posisi sample dan envelope maju. Voice akibatnya membeku selama mute lalu kembali bersamaan saat unmute. Timeline voice sekarang selalu bergerak secara silent, sementara output group memakai smoothing 5 ms untuk transisi mute/solo tanpa click atau lonjakan awal.
- Regresi lulus: frontend penuh `218 passed`, backend VST terkait `142 passed`, native penuh `139 passed`, Python compile, dan `git diff --check`. Smoke editor staging membuktikan waveform `240x120` dapat diubah menjadi `48x48`, payload PUT menyimpan geometri baru, dan reload tetap `48x48` pada posisi yang sama.
- Native fix sudah di-commit/push selektif ke `main` sebagai `1899dfe` (`Keep muted sampler voices advancing`). Smoke Windows run `40090606462` dan macOS run `40090608762` sukses, termasuk build serta install/uninstall. Artifact Windows `12558563881`, digest `sha256:e71b26eae0c17f382e6847a4f769caf49004cd783e3e993c6a8a3976f2e3984f`; artifact macOS `12559290193`, digest `sha256:503f19c379da3fd13e9ecd60e7bddb21432a8c14d748fb33cde954253f7eea84`.
- Worker Windows menerima overlay terbatas `NativeInstrument.cpp/.h` setelah active builds dan jobs `0`. Hash remote cocok dengan VPS (`ec59c605...17ce05e` dan `227406b6...18c87a4`); backup rollback `C:\TripleSideWorker\backups\mixer-mute-timeline-before-20261024T114300Z`. Task kembali `Running`, jobs `0`, dan tepat satu wrapper worker aktual PID `5248`.
- Backend direstart setelah active customer/all builds `0`; PM2 PID `1467186`, status `online`, unstable restart `0`, startup bersih. Fallback pipeline revision menjadi `mixer-mute-timeline-v1`. API lokal/publik dan Nginx sehat.
- Frontend dipasang lewat swap atomik. Live memakai `main.d478d408.js` dan `main.2f6395d7.css`; hash publik/lokal cocok: JS `b4f87a13d7e2e81d6b5ebf8ef4faf9626ae2db1b1b7063527a76acd916d70510`, CSS `b1b064f734675a87223c1b483fb50f474d11ae1b5dc2cc693c1f0bd5b0265286`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261024T114429Z-before-spectrum-mixer-fix`.
- Smoke browser produksi: HTTP `200`, bundle baru termuat, root terisi, tidak ada overflow, runtime error, atau console error. Dispatcher macOS tetap enabled/active dan workflow GitHub aktif `0`. Tidak ada job/build/artifact pelanggan yang dibuat, dibatalkan, diklaim, atau diubah; source dirty/untracked lain tetap dipertahankan.

## SELESAI 2026-10-24 — indikator simpan lisensi admin tidak lagi tampak macet

- Laporan lanjutan pengguna bukan kegagalan penyimpanan: request dashboard nyata `PUT /api/admin/vst-maker/build-settings` menjawab `200 OK`, dan database membuktikan pilihan pengguna sudah tersimpan menjadi `3` komputer pada `2026-10-24T10:43:22.566365+00:00`.
- Akar masalah visual ada pada CSS: tombol dinonaktifkan setelah berhasil karena form tidak lagi dirty, tetapi semua state `disabled` diberi `cursor: wait`. Akibatnya pointer tetap berupa ikon berputar walaupun request sudah selesai.
- Tombol sekarang memakai `aria-busy`: kursor tunggu dan spinner hanya aktif selama request berlangsung. Setelah berhasil, ikon berubah menjadi centang, label menjadi `Tersimpan`, dan kursor kembali normal. Saat nilai diubah lagi, label kembali `Simpan pengaturan lisensi`.
- Tes fokus frontend `31 passed`, `git diff --check` bersih, optimized staging build berhasil, dan bundle live diverifikasi memiliki status/cursor baru.
- Frontend live memakai `main.1d0ee8f0.js` dan `main.2f6395d7.css`; hash publik/lokal cocok: JS `d38604a82f733177d736c4c85881b9e56202cbf36e22ddc0b3e14c912dc471dc`, CSS `b1b064f734675a87223c1b483fb50f474d11ae1b5dc2cc693c1f0bd5b0265286`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261024T105104Z-before-license-cursor-fix`.
- API publik dan Nginx sehat; audit sebelum/sesudah deployment active customer/all builds `0`. Backend, worker, job, dan artifact pelanggan tidak diubah pada hotfix ini.

## SELESAI 2026-10-24 — lisensi komputer dikendalikan admin dan copy kredit dibersihkan

- Pengaturan `Komputer per lisensi` pada Admin VST Maker sekarang menjadi nilai otoritatif untuk Creator, Studio, dan Partner; Personal tetap selalu satu komputer. Nilai lama di project/customer tidak lagi dapat menurunkan angka yang ditetapkan admin.
- Pilihan jumlah komputer di dialog `Langkah terakhir sebelum build` sudah dihapus. Dialog hanya menampilkan jumlah read-only dari quote backend dengan keterangan bahwa angka mengikuti pengaturan TripleSide.
- Tombol simpan admin tidak lagi dapat berputar tanpa batas: request memakai timeout 15 detik, response dinormalisasi, dan state loading selalu dilepas pada `finally`. Endpoint PUT lokal dan publik diuji memakai nilai produksi yang sama dan keduanya menjawab `200` dengan `license_max_activations=2`.
- Opsi legacy customer license/tanpa serial dipaksa `true/false` oleh backend untuk kompatibilitas response, sehingga satu-satunya kontrol admin yang masih efektif adalah jumlah komputer. Pengujian payload legacy terbalik tetap menghasilkan konfigurasi bersih tersebut.
- Semua copy user-facing tentang kredit, saldo produksi, potongan kredit, dan biaya komponen sudah dihapus dari VST Studio, dialog build, analyzer, halaman template/asset, dan pembelian paket. Metadata SEO billing juga memakai istilah `Plans & Build Rights`.
- Verifikasi: backend fokus final `12 passed`, frontend penuh `217 passed`, tes frontend fokus setelah penambahan regresi `31 passed`, Python compile, `git diff --check`, dan optimized staging build berhasil. Bundle staging/live diperiksa memuat copy pengaturan baru dan tidak memuat tiga copy legacy utama.
- Backend direstart setelah active builds `0`; PM2 PID `1460302`, status `online`, unstable restart `0`, startup bersih. API lokal/publik sehat, Nginx valid, dan audit akhir active customer/all builds tetap `0`. Setting produksi tetap `2` komputer, license enabled, tanpa opsi no-serial.
- Frontend dipasang melalui swap atomik. Live memakai `main.3a8ae634.js` dan `main.baf8f23d.css`; hash publik/lokal cocok: JS `114c07dc1ab29f858f1a1645dee7e1d4234392e721bc03f2c58e48e4300772ce`, CSS `460e5759977189a249f14f98d5b430f3fed076515145048837254b9daacd9295`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261024T104023Z-before-admin-license-fix`.
- Tidak ada build/job/artifact pelanggan yang dibuat atau diubah. Source tetap dirty/untracked sesuai baseline dan belum di-commit/push.

## SELESAI 2026-10-24 — admin grant paket VST berdasarkan email

- Tab `VST Maker Licenses` sekarang memiliki form `Berikan Paket VST Gratis`: admin memasukkan email akun terdaftar, memilih Personal/Creator/Studio, menambahkan catatan internal opsional, lalu mengonfirmasi pemberian.
- Endpoint baru `POST /api/admin/vst-maker/business/grants` memvalidasi email dan status akun, hanya menerima tiga paket berbayar, serta membuat entitlement aktif bernilai pembayaran `0`. Paket belum terikat project dan baru terikat saat customer memulai build pertama.
- Setiap grant mencatat `source=admin_grant`, admin pemberi, email penerima, catatan, timestamp, dan UUID request. `transaction_id` berbasis UUID memakai index unik yang sudah ada sehingga retry request yang sama idempotent, tetapi admin tetap dapat memberikan pembelian gratis kedua melalui tindakan baru bila memang diperlukan.
- Tes backend fokus `17 passed`, frontend penuh `217 passed`, Python compile dan `git diff --check` bersih. Staging browser berhasil mengirim payload simulasi, menampilkan toast sukses, dan mereset form tanpa runtime/console error.
- Backend direstart setelah active builds `0`. Endpoint production lokal/publik terverifikasi aman memakai email yang tidak ada dan sama-sama menjawab `404 Email customer belum terdaftar`; tidak ada entitlement produksi yang dibuat saat pengujian (`admin_grants=0`, total entitlement `0`).
- Frontend live memakai `main.b94ac198.js` dan `main.baf8f23d.css`; hash publik/lokal cocok: JS `11d610bd52321bfc1fe39fbeef70d7ccdbec624e1adc11f834bf0aabf023e628`, CSS `460e5759977189a249f14f98d5b430f3fed076515145048837254b9daacd9295`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261024T1018Z-before-admin-plan-grant`.
- Browser smoke production authenticated memverifikasi form visible dan ketiga opsi paket tampil dengan detail haknya; HTTP `200`, runtime/console error `0`. PM2/API/Nginx sehat dan active builds tetap `0`.

## SELESAI 2026-10-24 — storefront paket VST profesional

- Halaman `/vst-maker/billing` didesain ulang menjadi storefront pricing yang lebih profesional: hero/value proposition, empat kartu Free/Personal/Creator/Studio, penekanan Creator sebagai rekomendasi, jumlah build/platform/masa koreksi yang eksplisit, harga normal dan persentase hemat, jalur Partner terpisah, tabel perbandingan, trust points, dan CTA penutup.
- Desktop dan mobile staging terverifikasi tanpa horizontal page overflow; pricing, Partner, tabel hak, dan penjelasan serial tambahan tampil utuh. Frontend penuh `216 passed`, optimized staging build sukses, dan `git diff --check` bersih.
- Harga lisensi/serial tambahan belum memiliki product maupun endpoint pembelian self-service. UI sekarang menyatakan hal tersebut secara transparan dan mengarahkan kebutuhan di atas kuota Creator 100/Studio 1.000 kepada tim TripleSide. Pesan backend ketika kuota habis juga diperbaiki agar tidak lagi menyuruh membeli produk yang belum tersedia; tes distribusi `5 passed`.
- Frontend live memakai `main.c4e7b792.js` dan `main.89bdee85.css`; hash publik/lokal cocok: JS `d1d9873ee7c0a129e0cb23e9af4d65c674b47cf9d52d2fd0ba528dfbf8268aea`, CSS `2b4d550f997789dfab86a900ab67963031ecad2606fd766a00a23f2ef91eb773`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261024T1005Z-before-billing-redesign`.
- Browser smoke production desktop (`1440 px`) dan mobile (`390 px`) sama-sama HTTP `200`, lebar dokumen sama dengan viewport, root terisi, copy build/lisensi tampil, serta runtime/console error `0`. Backend direstart setelah active builds `0`; PM2 dan API lokal/publik sehat.

## SELESAI 2026-10-24 — daftar Products admin pulih setelah migrasi kredit

- Akar masalah: `/api/admin/products` masih mengambil 14 dokumen kredit/access pass yang sudah diarsipkan, sedangkan `DigitalProduct.asset_type` baru sengaja tidak lagi menerima kedua tipe lama. FastAPI menghasilkan `ResponseValidationError` dan HTTP `500`, sehingga frontend menampilkan daftar kosong meskipun produk toko tidak hilang dari database.
- Query admin sekarang mengecualikan `vst_access_pass` dan `vst_build_credit` dari katalog operasional. Riwayatnya tetap tersimpan untuk audit, sementara produk toko biasa dan `vst_business_plan` tetap tampil.
- Regresi baru `test_admin_product_catalog.py` ditambahkan. Tes fokus `14 passed`, Python compile dan `git diff --check` bersih.
- Backend direstart setelah active builds `0`. Endpoint authenticated lokal dan publik sama-sama `200`, masing-masing mengembalikan 17 produk dan `legacy_types_present: false`.
- Browser smoke production pada tab Products menampilkan `17 total`/17 baris, `VST Personal License` terlihat, empty state tidak muncul, dan runtime/console error `0`. Frontend tidak perlu dibangun ulang karena perbaikannya murni query backend.

## SELESAI 2026-10-24 — sistem kredit VST lama diganti bersih oleh paket bisnis

- Sistem kredit aktif sudah dihapus dari backend dan frontend: tidak ada saldo/potongan kredit, harga komponen, pembelian credit pack, grant admin, atau pembelian kuota distribusi terpisah. Endpoint checkout lama menjawab `410`; route pricing/grant/purchase lama tidak lagi didaftarkan.
- Model live sekarang: Free untuk seluruh Designer/preview tanpa build; Personal sekali bayar untuk satu project, satu platform, satu perangkat, dan koreksi 30 hari; Creator/Studio sekali bayar untuk satu project, dua platform, 100/1.000 serial, dan koreksi 60 hari; Partner tanpa biaya awal dengan terms, eksklusivitas marketplace, dan bagi hasil. Setiap paket build memiliki dua Rebuild Koreksi tanpa biaya komponen.
- Entitlement bisnis mengikat pembelian secara idempotent ke project/platform. Creator dan Studio otomatis memperoleh kapasitas distribusi dari build siap tanpa pembelian kredit tambahan. Personal dipaksa satu aktivasi perangkat; Partner mengikuti jalur marketplace.
- Seluruh 14 produk paket/kredit lama berstatus `archived` dan `0` masih published. Tiga produk baru published: Personal Rp199.000, Creator Rp749.000, Studio Rp2.490.000. Katalog publik hanya mengembalikan `free`, `personal`, `creator`, `studio`, `partner` dan tidak memiliki `credit_packs`.
- Riwayat lama tidak dihapus: dua transaksi Free bernilai Rp0, dua wallet dengan snapshot saldo 1.813 dan 2.000, 97 credit events, serta satu pricing snapshot dipertahankan khusus audit. Seluruh dokumen tersebut diberi marker `legacy_system_archived_at`/`replaced_by_vst_business_plans`; kode baru tidak membaca koleksi lama. Tidak ada transaksi kredit berbayar yang perlu dikonversi.
- Mekanisme slot `studio_period`/`ultimate_active_owner` dan kedua index uniknya sudah dihapus. Startup sekarang mengarsipkan state lama secara idempotent dan memastikan index usang tidak muncul kembali.
- Regresi final: backend VST `178 passed`; pemeriksaan tambahan sesudah migrasi startup `18 passed`; frontend penuh `213 passed`; Python compile dan `git diff --check` bersih. Optimized staging build dan smoke browser staging lulus untuk pricing publik serta VST Studio terautentikasi, dengan runtime/console error `0`.
- Backend PM2 direstart setelah audit active builds `0`; PID live `1449598`, status `online`, unstable restart `0`, startup tanpa error. API lokal/publik dan konfigurasi Nginx sehat. Audit akhir tetap menunjukkan active builds `0`, business entitlement `0`, dan index lama tersisa `0`.
- Frontend dipasang lewat swap atomik. Live memakai `main.6edcb573.js` dan `main.f9b8bebf.css`; hash publik/lokal cocok: JS `91a82bffd3086ae25c74545badd46c4ef72e720a25a46f471532981acf7c07a1`, CSS `f06983c2e61c30e4d463c0cd49af19180340e5950a1eedd791b56e8d9ef4a05a`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261024T0843Z-before-credit-removal`.
- Smoke production membalas HTTP `200` untuk pricing publik dan VST Studio customer-simulasi; root terisi, paket Creator tampil, credit pack lama tidak tampil, dan runtime/console error `0`. Source tetap dirty/untracked sesuai baseline dan belum di-commit/push.

## SELESAI 2026-10-24 — audit penutup sistem bisnis VST dan Partner Marketplace

- Audit read-only pada `02:49 UTC` memastikan backend PM2 `online` dengan unstable restart `0`, API lokal/publik serta katalog bisnis membalas `200`, dan konfigurasi Nginx valid.
- Production tetap memuat `main.8cec3ee4.js` dan `main.4761eab4.css`. SHA-256 live sama dengan file lokal dan sama dengan hash deployment: JS `d08e25a2342370e7beca4dab7e9bb5b5d30243b6a947d757a1b28ace4ac9a755`, CSS `31d8c4076b3d8bfa80f7bfd5e8469144e687e85f841fbf16e6aebffe4a9b95fc`.
- Log backend sejak restart deployment tidak memiliki `ERROR`, `CRITICAL`, traceback, exception, atau kegagalan aplikasi. Poll worker tetap mendapat `204 No Content` ketika tidak ada job.
- Tes fokus backend final lulus `24 passed`; frontend penuh lulus `226 passed`; `git diff --check` bersih.
- Audit database sesudah tes: active customer builds `0`, seluruh active builds `0`, partner products `0`, partner earnings `0`, dan partner payouts `0`.
- Tidak ada rebuild, redeploy, restart, mutasi worker/job/artifact/data customer, commit, atau push pada audit penutup ini. Deployment sistem bisnis dinyatakan selesai; source tetap pada worktree production dirty/untracked dan hanya boleh di-commit/push atas perintah eksplisit pengguna.

## DEPLOYED 2026-10-24 — sistem bisnis VST dan Partner Marketplace

- Source sekarang memiliki paket sekali bayar `Free Builder`, `Personal` Rp199 ribu (normal Rp299 ribu), `Creator Commercial` Rp749 ribu (normal Rp999 ribu), `Studio Commercial` Rp2,49 juta (normal Rp2,99 juta), dan `Marketplace Partner` tanpa biaya awal. Sistem kredit build lama tetap kompatibel dan tetap dijual terpisah.
- Pembelian Personal/Creator/Studio menghasilkan entitlement idempotent. Creator/Studio dapat memakai mode Commercial Direct dengan komisi marketplace 15%; Partner memakai 20% dari net settlement, eksklusif melalui TripleSide, dan dapat meningkatkan ke Direct. Entitlement Direct diikat ke satu project dan memberi paket distribusi 100/1.000 serial melalui sistem lisensi yang sudah ada.
- Customer Partner memiliki persetujuan terms versioned, rekening payout, pembuatan listing dari artifact build `ready` yang memakai DRM, moderasi, dashboard unit/refund/bruto/biaya gateway/net settlement/komisi/hak partner/saldo, serial issued/activated, unduhan unik, ledger pembeli tersamarkan, ekspor CSV/PDF, dan permintaan payout.
- Pembayaran marketplace memakai snapshot komisi, menerbitkan serial yang memakai `license_product_id` yang tertanam dalam plugin, serta membuat earning ledger idempotent. Artifact listing dipin agar tidak dihapus retensi build. Saldo ditahan 14 hari dan tidak dapat tersedia sebelum biaya gateway direkonsiliasi sebagai final.
- Admin memiliki panel dan API untuk moderasi listing, ledger penjualan, rekonsiliasi settlement, refund/chargeback (sekaligus revoke serial), serta approve/reject payout dengan referensi transfer. Index unik ditambahkan untuk entitlement, earning per transaksi, listing per build, download per transaksi/platform, dan payout.
- Verifikasi: unit/regresi backend fokus `24 passed` (5 tes bisnis baru + 19 regresi terkait), frontend penuh `226 passed`, dua optimized build staging lulus, dan `git diff --check` bersih. Percobaan backend suite penuh menghasilkan `348 passed`, `18 skipped`, tetapi 46 fail/52 error berasal dari kelompok integration HTTP yang dijalankan tanpa `BACKEND_URL` valid (`404 page not found`/URL relatif), bukan dari tes unit in-process.
- Backend direstart satu kali melalui PM2 pada `02:39 UTC`; status `online`, PID setelah restart `1416206`, unstable restart `0`, startup/seed/index selesai tanpa error. Ketiga produk berbayar live: Personal `199000`, Creator `749000`, Studio `2490000`; endpoint katalog publik serta enam endpoint authenticated customer/admin yang diuji semuanya membalas `200`.
- Frontend dipasang melalui swap atomik. Live memakai `main.8cec3ee4.js` dan `main.4761eab4.css`; hash publik/lokal cocok: JS `d08e25a2342370e7beca4dab7e9bb5b5d30243b6a947d757a1b28ace4ac9a755`, CSS `31d8c4076b3d8bfa80f7bfd5e8469144e687e85f841fbf16e6aebffe4a9b95fc`. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261024T0241Z-before-vst-business`.
- Browser smoke production memverifikasi pricing publik, dashboard Partner customer-simulasi, dan tiga tab admin marketplace; bundle baru termuat, root terisi, runtime/console error `0`. API lokal/publik sehat dan Nginx valid.
- Audit akhir `02:41 UTC`: active customer builds `0`, seluruh active builds `0`, marketplace products/earnings/payouts masih `0`. Tidak ada worker/native/compiler, job, build, atau artifact pelanggan yang diubah. Source belum di-commit atau di-push.

### Perintah untuk sesi baru — audit akhir dan penyelesaian source

Salin instruksi ini sebagai pesan pertama pada sesi baru:

> Baca `/home/triplesidestudio/tripleside/CODEX_HANDOFF.md` seluruhnya. Lanjutkan bagian paling atas `DEPLOYED 2026-10-24 — sistem bisnis VST dan Partner Marketplace`. Jangan deploy ulang bila bundle/API sudah cocok. Jalankan audit read-only di bawah, pastikan active builds tetap 0, periksa log error setelah deployment, dan laporkan hasil. Jangan mengubah worker, job, build, artifact, atau data customer. Jangan commit/push kecuali saya memerintahkannya secara eksplisit.

Jalankan dari workspace:

```bash
cd /home/triplesidestudio/tripleside

# Health dan proses
pm2 show triplesidestudio-backend --no-color
curl -fsS http://127.0.0.1:8000/api/
curl -fsS https://triplesidestudio.com/api/
curl -fsS https://triplesidestudio.com/api/vst-maker/business/catalog
sudo -n nginx -t

# Bundle live dan integritas terhadap hash deployment
curl -fsS 'https://triplesidestudio.com/?audit=vst-business' \
  | rg -o 'main\.[a-f0-9]+\.(js|css)' | sort -u
curl -fsS https://triplesidestudio.com/static/js/main.8cec3ee4.js | sha256sum
curl -fsS https://triplesidestudio.com/static/css/main.4761eab4.css | sha256sum
sha256sum \
  frontend/build/static/js/main.8cec3ee4.js \
  frontend/build/static/css/main.4761eab4.css

# Tes fokus yang tidak menyentuh data produksi
cd /home/triplesidestudio/tripleside/backend
venv/bin/python3 -m pytest -q \
  tests/test_vst_business_service.py \
  tests/test_vst_billing_service.py \
  tests/test_engineer_shop.py \
  tests/test_distribution_licenses.py \
  tests/test_r2_download_contract.py
```

Audit database read-only untuk memastikan tidak ada build aktif dan melihat apakah marketplace mulai dipakai:

```bash
cd /home/triplesidestudio/tripleside/backend
venv/bin/python3 - <<'PY'
import asyncio
from core import db, mongo_client

ACTIVE = ["queued", "preparing", "building", "validating", "retrying"]

async def main():
    print("active_customer_builds=", await db.vst_maker_build_jobs.count_documents({
        "status": {"$in": ACTIVE}, "owner_customer_id": {"$type": "string"},
    }))
    print("active_all_builds=", await db.vst_maker_build_jobs.count_documents({
        "status": {"$in": ACTIVE},
    }))
    print("partner_products=", await db.products.count_documents({
        "owner_vst_customer_id": {"$exists": True},
    }))
    print("partner_earnings=", await db.vst_partner_earnings.count_documents({}))
    print("partner_payouts=", await db.vst_partner_payouts.count_documents({}))

asyncio.run(main())
mongo_client.close()
PY
```

Jika frontend harus di-rollback karena smoke production gagal, jangan hapus direktori mana pun. Setelah memastikan target eksplisit dan active builds `0`, lakukan swap balik atomik dari backup berikut:

```bash
cd /home/triplesidestudio/tripleside/frontend
# Hanya jalankan bila rollback benar-benar diperlukan:
test ! -e build-failed-vst-business-20261024
mv build build-failed-vst-business-20261024
mv build-backup-20261024T0241Z-before-vst-business build
```

Jangan menjalankan `npm run build` tanpa `BUILD_PATH`, jangan mengulang seed secara manual, dan jangan menjalankan suite integration HTTP penuh tanpa `BACKEND_URL` yang valid. Jika audit bersih, pekerjaan deployment selesai; yang tersisa hanya commit/push source bila pengguna meminta.

## Kondisi saat ini

- Production frontend, backend, worker Windows, dan dispatcher macOS sehat.
- Commit resmi terbaru: `6f9449c` (`Keep build downloads behind license dialog`), setelah commit parity `176e91e` dan fix macOS `1175ec9`; `HEAD`, `origin/main`, dan GitHub `main` cocok.
- Frontend live: `main.8cec3ee4.js` dan `main.4761eab4.css`.
- SHA-256 live/lokal cocok:
  - JS: `d08e25a2342370e7beca4dab7e9bb5b5d30243b6a947d757a1b28ace4ac9a755`
  - CSS: `31d8c4076b3d8bfa80f7bfd5e8469144e687e85f841fbf16e6aebffe4a9b95fc`
- Pipeline revision live: `stomp-spectrum-toggle-parity-v2`.
- `Stomp Footswitch` dan `Bar Spectrum Visualizer` sudah memiliki parity frontend, schema/build spec, compiler, capture/verifier, runtime Windows, runtime macOS, packaging asset, serta worker production. Footswitch memakai PNG OFF/ON yang sama; visualizer memakai analyser audio real-time 48 band, FFT 2048, LR-max stereo, tilt 4,5 dB/oct, range 90 dB, attack 45 ms, dan release 340 ms.
- Gap teks status Mechanical Toggle sekarang persisten melalui `state_label_gap` `0–32 px`, dengan migrasi project lama dari `label_y`. Frontend, compiler, capture, Windows, dan macOS memakai anchor visual yang sama; OFF/ON tetap sejajar dan gap `0` dapat benar-benar mepet.
- Plain Round LED memakai minimum `12×12 px` lintas schema, normalizer, compiler, hit-testing, capture, Windows, dan macOS. Loading factory/user preset native mempertahankan groove/MIDI loop yang sedang berjalan.
- Wave Generator `Pattern Lab` dan `Live Trigger` sudah live. Arpeggiator, Step Sequencer, Bassline Generator, serta Melody Generator mengikuti root tuts selama ditahan; mode Chord memainkan tepat satu chord sampai tuts dilepas.
- `Live Trigger` sekarang berada tepat di sebelah `Preview` pada setiap Generated Pattern dan eksklusif satu pola. Chord memiliki mode `1 Chord` atau `Chord Berjalan`; progression bebas menerima degree I–VII/1–7, sedangkan 1 Chord mendukung Major, Minor, Major 7, Minor 7, Sus 2, Sus 4, dan Aug.
- Template admin `neonpopdrums` / `Neon Pop Rock Drums` sudah diganti memakai isi project tersimpan `092b3d46-6e53-44bf-b5c8-2ecfb272bce2`: 11 sample, 12 sample mapping, 12 MIDI sequence, 12 preset, dan 22 interface control. ID sumber admin tetap `8ecf96f3-7b09-45e2-825d-1baf46440e7a`, thumbnail/order/featured setting tetap, dan project pelanggan sumber tidak diubah.
- Button/Pad build Windows yang dipautkan ke Generated Pattern sekarang menampilkan state Live Trigger transient yang sebenarnya. Capsule Button maupun Mechanical Toggle langsung berpindah frame saat di-arm/disarm; pad pola tidak lagi ditimpa state note biasa. Perilaku tetap sesuai kontrak: klik meng-arm pola, lalu keyboard/MIDI menentukan root dan velocity.
- Scheduler preview Pattern Lab memakai look-ahead Web Audio 250 ms, prewarm AudioContext/DSP, tidak lagi mengirim ulang plan DSP pada setiap nada, dan tidak memotong nada sebelum batas loop.
- Nada Wave Generator mode Mono + Retrigger tidak lagi menggantung ketika tuts overlap dilepas dalam urutan berbeda. Voice lama dikeluarkan dari registry secara sinkron sebelum voice pengganti dibuat, dan perpindahan token fallback tidak dapat meng-orphan-kan voice aktif.
- Klik/pecah pada preview Arpeggiator, Step Sequencer, Bassline, dan Melody sudah diperbaiki, termasuk klik tepat di batas loop: release terjadwal memakai nilai envelope pada timestamp audio sebenarnya, release yang sudah berjalan tidak dimulai ulang saat loop berganti, attack nol mendapat de-click 3 ms, dan voice tetap dapat dihentikan sampai source selesai.
- Preview Wave Generator polos dan Live Trigger Chord Generator `1 Chord` kini bebas start/cut mendadak: nada langsung memakai headroom 12 ms, seluruh voice chord memakai satu timestamp audio bersama dengan headroom 20 ms, chord dilepas melalui release envelope preset, lalu gain benar-benar mencapai nol sebelum oscillator dihentikan.
- Neon Pop Rock Drum sekarang mengirim revision trigger untuk setiap MIDI note-on. Dua hit cepat dengan pitch sama tidak lagi melebur menjadi satu boolean visual; flash di-restart satu paint dan token MIDI pitch sama disimpan FIFO agar note-off lama tidak mematikan retrigger baru.
- Chord Generator progression bebas sekarang berfokus pada input angka degree `1–7`; field dapat dihapus hingga kosong tanpa nilai default muncul kembali. Format Romawi project lama tetap kompatibel.
- Button/Pad Designer dapat dipautkan hanya ke Generated Pattern. Klik komponen meng-arm/disarm Live Trigger; keyboard/MIDI menentukan root dan velocity, release menghentikan pola. Binding `midi_sequence_id` persisten dan perilakunya sama pada preview serta runtime native Windows/macOS. State ON saat ini tetap transient, sedangkan binding polanya tersimpan.
- Kartu dan perilaku `Efek kompatibilitas project lama` sudah dihapus. Frontend membersihkan flags lama menjadi `{}`, pricing tidak menagihnya, build spec mengabaikannya, dan compiler native selalu menonaktifkannya. Data historis database tidak dihapus.
- Komponen `Realtime Waveform` dan `Round LED Indicator` sudah tersedia di Designer, mendukung warna, dan memiliki parity preview/build native Windows/macOS. LED dapat manual on/off atau ditautkan ke state tombol, pad, panel, atau parameter lain.
- Build Windows Arctic Macro Synth terakhir `0ab567ac-18cd-4954-9706-929bb6d9e38a` berstatus ready tetapi dibuat sebelum fix feedback kontrol `d7839a0`; artefaknya immutable dan pengguna perlu menjalankan Rebuild Windows untuk memperoleh fix. Build gagal sebelumnya `103a123a-2994-463a-af6b-3c539eb4dbbc` tetap immutable dan kreditnya sudah otomatis direfund.
- Smoke lintas platform commit `1175ec9` lulus build, packaging, install/uninstall, dan upload artifact: Windows run `39992542154`, artifact `12518566826`, digest `sha256:3ec18f1820553c89e53db50a1a573bd66f8169c80e4b1e84da212449318f5d79`; macOS Universal run `39992548184`, artifact `12519095658`, digest `sha256:eec5a43d3eba39452763d7517fb53139c1a8b9cd233664a3d4a413c37a5cb9c6`.
- Worker Windows sudah disinkronkan untuk seluruh file parity baru. Hash `NativeView.cpp` `9cc52156...8b5fcd`, `BarSpectrumAnalyzer.h` `b003e3d5...b19a39`, dan `compile_manifest.py` `ead62b50...dfcb5` cocok dengan VPS/GitHub. Task `Running`, tepat satu proses PID `3840`, jobs `0`. Backup terbaru: `C:\TripleSideWorker\backups\full-native-parity-before-20261023T171227Z`.
- Dispatcher macOS timer `enabled/active`, tidak ada workflow worker aktif, dan GitHub `main` menunjuk commit terbaru sehingga build selanjutnya memakai baseline baru.
- Backend PM2 online, API lokal/publik terverifikasi `status: ok`, dan konfigurasi Nginx valid.
- Tidak ada job pelanggan yang dibuat, diklaim, diulang, dibatalkan, atau diubah. Artefak lama tetap immutable.
- Catatan source: perubahan native/parity sudah di-commit. Source frontend/backend fitur ini tetap berada pada baseline worktree production yang memang dirty/untracked; jangan menjalankan clean/reset atau men-stage massal.

## SELESAI 2026-10-23 — tombol download tidak menembus dialog lisensi

- `Unduh build terakhir` sebelumnya tetap terlihat di atas langkah akhir lisensi karena wrapper download memakai `z-index: 220`, sedangkan overlay dialog hanya `z-index: 120`. Tombol juga tetap dirender pada panel build ringkas maupun panel progress selama dialog terbuka.
- Overlay dialog sekarang memakai layer `300`. Kedua lokasi `LatestBuildDownloadMenu` tidak dirender ketika `buildLicenseDialogOpen`; panel progress menerima flag `hideDownloads` agar perilakunya sama.
- Tes fokus `31 passed`, frontend penuh `226 passed`, `git diff --check` bersih, dan optimized build staging lulus. Browser staging serta production customer-simulasi memverifikasi tombol download berjumlah `1` sebelum dialog dan `0` saat dialog terbuka, computed overlay `300`, Designer ter-render, serta console/runtime/request error `0`.
- Commit `6f9449c` sudah dipush. Frontend dipasang melalui swap atomik; backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261023T175524Z-before-license-dialog-layer`. Live memakai `main.e149c728.js`/`main.d4a22eef.css` dengan hash publik dan lokal identik serta mode direktori `775`.
- Active customer builds sebelum/sesudah deployment `0`. Backend, pipeline revision, worker Windows/macOS, dan seluruh job/artifact pelanggan tidak diubah.

## SELESAI 2026-10-23 — cegah reuse artifact yang dibuat sebelum overlay worker

- Tombol Build Windows sempat langsung menunjukkan `100%` karena backend memakai ulang job Arctic Macro Synth `121269ec-67aa-45ca-a3ee-68b91bbd61c3`, yang berstatus `ready` dengan revision `stomp-spectrum-toggle-parity-v1` dan spec identik.
- Job tersebut dibuat `14:55 UTC` dan selesai `15:00 UTC`, sedangkan worker Windows baru menerima overlay parity final pada `17:12 UTC`. Jadi revision v1 sudah aktif terlalu awal dan dapat menandai artifact dari worker lama sebagai reusable.
- Pipeline revision production dinaikkan menjadi `stomp-spectrum-toggle-parity-v2` di environment dan fallback source. Backend direstart hanya setelah active customer builds `0`; tes fokus queue/spec/worker `73 passed`.
- Setelah restart, PM2 online, API lokal/publik sehat, Nginx valid, worker Windows tetap `Running` dengan satu PID `3840` dan jobs `0`. Database memiliki `0` artifact Windows `ready` dengan revision v2, sehingga klik Build berikutnya tidak dapat memakai ulang artifact pra-overlay tersebut dan harus membuat job revision baru.
- Artifact v1 tetap immutable dan tidak dihapus atau diubah. Tidak ada job pelanggan yang dibuat, di-claim, di-retry, dibatalkan, atau dimutasi dalam perbaikan ini.

## SELESAI 2026-10-23 — parity native seluruh preview tertunda

- Commit utama `176e91e` menyinkronkan Stomp Footswitch, Bar Spectrum Visualizer, gap semantik Mechanical Toggle, minimum LED `12×12 px`, dan lifecycle preset yang mempertahankan groove ke compiler, capture, runtime Windows/macOS, serta packaging. Commit `1175ec9` memperbaiki namespace `BarSpectrumAnalyzer` pada Objective-C++ macOS dan menambahkan regresinya.
- Stomp Footswitch membawa pasangan PNG OFF/ON identik ke frontend serta resource native. State parameter, Generated Pattern transient, linked LED, hit target, opacity, rotation, dan resize mengikuti kontrak preview.
- Bar Spectrum native adalah analyser output audio real-time: 48 band log 35 Hz–18 kHz, FFT 2048, power/RMS plus peak ringan, LR-max stereo, tilt 4,5 dB/oct terhadap 1 kHz, range 90 dB, attack 45 ms, release 340 ms, serta bar persegi simetris dan transparan.
- `state_label_gap` `0–32 px` tersimpan dan dimigrasikan dari `label_y` untuk project Mechanical Toggle lama. Minimum Round LED `12×12 px` berlaku lintas schema/layout/compiler/runtime. Factory/user preset Windows dan macOS tidak lagi menghentikan groove yang sedang berjalan.
- Verifikasi final: frontend penuh `225 passed`, backend VST `182 passed`, native penuh `138 passed`, dan `git diff --check` bersih. Browser production sebelumnya memverifikasi renderer tanpa runtime error; hash bundle/aset publik cocok dengan direktori live.
- Smoke Windows run `39992542154` dan macOS Universal run `39992548184` sama-sama lulus build, install/uninstall, serta upload artifact pada commit `1175ec9`. Kegagalan macOS awal run `39963326938` pada commit `176e91e` disebabkan nama class tanpa namespace dan sudah ditutup oleh commit kedua.
- Worker Windows dioverlay terbatas setelah active customer builds `0`, jobs `0`, dan workflow aktif `0`; sembilan hash source/compiler/aset cocok dengan VPS. Backup rollback: `C:\TripleSideWorker\backups\full-native-parity-before-20261023T171227Z`. Task kembali `Running` dengan satu wrapper PID `3840` dan jobs `0`.
- Pipeline production semula memakai revision `stomp-spectrum-toggle-parity-v1`; setelah audit urutan overlay, revision dinaikkan lagi menjadi `stomp-spectrum-toggle-parity-v2`. Frontend live `main.48c46620.js`, PM2/API lokal-publik/Nginx sehat, dispatcher macOS `enabled/active`, dan GitHub `main` menunjuk `1175ec9`.
- Tidak ada job pelanggan yang dibuat, di-claim, di-retry, dibatalkan, atau dimutasi. Artifact pelanggan lama tetap immutable; build baru diperlukan untuk memperoleh parity ini.

## SELESAI 2026-10-23 — baseline teks ON disamakan dengan OFF

- Umpan balik pengguna setelah deployment sebelumnya: posisi OFF sudah benar, tetapi ON terlalu tinggi dan tidak sejajar. Penyebabnya adalah anchor ON mengikuti batas alpha bawah gambar ON; saat tuas bergerak ke atas, teks ikut naik.
- Kedua state sekarang memakai anchor batas visual OFF yang sama. Pada browser staging, computed `top` OFF dan ON identik untuk ukuran kontrol `48×64`, `100×132`, dan `240×300`, masing-masing pada slider `0`, `5`, dan `32 px`. Toggle tetap persegi, overflow label tetap visible, opacity tetap bekerja, dan smoke komponen nyata mempertahankan rotasi `27°`.
- Tes frontend penuh `224 passed`, tes fokus `34 passed`, optimized staging build lulus, dan `git diff --check` bersih.
- Frontend dipasang melalui swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261023T132115Z-before-toggle-on-alignment`. Production memakai `main.c0e89f92.js` dan `main.e521ad95.css`; hash publik/lokal cocok.
- Browser production memverifikasi computed `top` OFF dan ON sama-sama `58,7969 px`, PNG serta teks berubah OFF→ON, Designer ter-render, root terisi, dan console/runtime/request error `0`.
- PM2 online, API lokal/publik sehat, Nginx valid, active customer builds sebelum/sesudah `0`. Backend, native/compiler, worker Windows/macOS, pipeline revision, dan job pelanggan tidak diubah; tunggu persetujuan visual sebelum sinkronisasi parity.

## SELESAI 2026-10-23 — gap ON/OFF Mechanical Toggle mengikuti piksel visual

- Akar jarak minimum yang masih longgar ada dua: label masih memakai `top: 100%` terhadap kotak tombol, dan aturan flex umum meregangkan Mechanical Toggle besar menjadi persegi panjang. Selain itu frame PNG OFF dan ON memiliki batas alpha bawah berbeda.
- Mechanical Toggle sekarang mempertahankan bidang persegi responsif setelah aturan layout umum diterapkan. Anchor label memakai batas alpha `>=32` masing-masing aset v4: OFF `606/608`, ON `474/608`, sekaligus memperhitungkan inset gambar `17 px`.
- Browser staging mengukur OFF dan ON pada kontrol `48×64`, `100×132`, dan `240×300`: slider `0`, `5`, dan `32 px` menghasilkan gap aktual `-0,01–0`, `4,99–5`, dan `31,99–32 px`. Tidak ada ancestor clipping; opacity `41%` tetap bekerja. Smoke komponen nyata juga mempertahankan rotasi `27°` dan mengganti PNG/label OFF→ON tanpa error.
- Tes frontend penuh `224 passed`; tes fokus akhir `34 passed`; optimized staging build lulus; `git diff --check` bersih.
- Frontend dipasang melalui swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261023T131431Z-before-toggle-visual-gap`. Production memakai `main.c0e89f92.js` dan `main.6cc06315.css`; hash publik/lokal cocok.
- Browser production mengukur gap OFF `-0,01 px` dan ON `-0,01 px` pada nilai slider `0`, Designer ter-render, root terisi, serta console/runtime/request error `0`. PM2 online, API lokal/publik sehat, Nginx valid, dan active customer builds sebelum/sesudah deployment `0`.
- Perubahan hanya frontend dan handoff. Backend, compiler, runtime native, worker Windows, dispatcher macOS, pipeline revision, serta seluruh job/build pelanggan tidak diubah. Tunggu persetujuan visual pengguna sebelum memulai paket sinkronisasi parity.

## SELESAI 2026-10-23 — jarak label Mechanical Toggle, resize Plain Round LED, dan loop lintas preset

- Inspector Mechanical Toggle memiliki slider baru `Jarak teks ON/OFF ke toggle` dengan rentang `0–32 px`. Nilainya memakai offset `label_y` yang sudah diterima format project/backend, sehingga preview frontend dapat disimpan tanpa menambah kontrak native baru. Default project lama tetap setara `5 px`.
- Plain Round LED sekarang benar-benar dapat di-resize sampai `12×12 px`. Logika layout sebelumnya sudah mempunyai minimum 12 px, tetapi CSS umum `.maker-canvas-control` masih memaksa minimum 48 px; override indicator serta border responsif kecil sudah diterapkan.
- Preset Browser tidak lagi memanggil `stopMidi()` saat preset dimuat. Sound, sampler group, DSP module, pattern terpilih, dan live-pattern config tetap diperbarui, sementara transport groove yang sedang loop terus berjalan.
- Frontend penuh `224 passed`, focused `63 passed`, `git diff --check` bersih, dan optimized staging build lulus. Browser staging bersih memverifikasi slider `0–32`, jarak visual `0` lalu `27 px`, computed layout LED `12×12 px`, loop tetap berstatus Stop/playing setelah preset berpindah, root terisi, dan console/runtime error `0`.
- Frontend dipasang melalui swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261023T125213Z-before-toggle-led-loop`. Browser production memuat `main.c0e89f92.js`, memverifikasi LED `12×12 px`, jarak ON/OFF berubah, loop bertahan melewati pemuatan preset, root terisi, dan error `0`; hash JS/CSS publik cocok dengan lokal.
- Perubahan sengaja hanya frontend; native/compiler/worker Windows/macOS tetap ditunda agar digabung dengan sinkronisasi berikutnya. PM2 online, API publik `status: ok`, Nginx valid, active customer builds sebelum/sesudah `0`, dan tidak ada job pelanggan yang dibuat atau diubah.

## SELESAI 2026-10-23 — preview frontend Stomp Footswitch dan Bar Spectrum Visualizer

- Komponen Button baru `Stomp Footswitch` memakai dua PNG transparan 512×512 yang dibuat dari referensi pengguna: nut chrome heksagonal, washer konsentris, serta plunger brushed-metal. State OFF menonjol dan state ON tertekan; tidak ada bodi pedal, plat, logo, teks, atau LED.
- Aset live: `stomp-footswitch-off-v1.png` SHA-256 `8df46ebb84c767c7ce5ef85a6c9854942bba7498a2dfcb7efe2d1536f34da524` dan `stomp-footswitch-on-v1.png` SHA-256 `504df6478d8fbef1e9314c910ce3fa4053a038d3cc78116d6dee3b8062c75412`.
- Komponen Spectrum baru `Bar Spectrum Visualizer` memakai FFT output real-time. Revisi final preview menggunakan 48 band tetap, FFT 2048-point, smoothing internal analyser `0`, agregasi power/RMS plus peak ringan, LRmax stereo, tilt 4,5 dB/oct, range 90 dB, serta attack 45 ms/release 340 ms berbasis elapsed time. Bar tetap berujung persegi, simetris terhadap centerline, memakai gradasi horizontal dari warna pilihan ke putih, dan background default transparan.
- Frontend penuh `224 passed`; optimized build staging lulus. Browser staging merender Designer, mengganti PNG OFF→ON, menampilkan canvas `451,75×191,125`, dan menghasilkan runtime error `0`.
- Browser staging memverifikasi ketiga analyser memakai FFT `2048`/smoothing `0`, silence menghasilkan `0` bar, seluruh 48 band merespons noise dalam 100 ms, release turun monoton, dan kembali `0` bar pada 2,2 detik; runtime error `0`.
- Browser production memuat `main.cbe7323c.js`, root terisi, silence `0` bar, 48 band aktif dalam 120 ms, mean height sustain `51,27` turun menjadi `11,69` setelah release 500 ms dan kembali `0` pada 2,2 detik; console/runtime error `0`.
- Frontend dipasang melalui swap atomik. Backup rollback terbaru: `/home/triplesidestudio/tripleside/frontend/build-backup-20261023T123405Z-before-bar-spectrum-standard`; backup tahap awal tetap tersedia di `/home/triplesidestudio/tripleside/frontend/build-backup-20261023T121743Z-before-stomp-spectrum-preview`. Hash JS/CSS/aset live cocok dengan staging; mode direktori live `775`.
- Perubahan sengaja hanya frontend. Backend/native/compiler/worker/pipeline revision tidak diubah, tidak ada commit baru, dan tidak ada sinkronisasi Windows/macOS sebelum persetujuan pengguna. PM2 online, API lokal/publik sehat, Nginx valid, active customer builds sebelum/sesudah `0`, serta tidak ada job pelanggan yang dibuat atau diubah.

## SELESAI 2026-10-23 — Neon Pop Rock Drums project tersimpan menjadi template admin

- Template stabil `neonpopdrums` diganti dari project admin lama yang kosong menjadi snapshot project tersimpan `092b3d46-6e53-44bf-b5c8-2ecfb272bce2` milik customer `60de1e26-c1ec-4899-85ac-dbb1384ace5f`.
- Arsitektur sumber template tetap aman: template masih menunjuk project admin `8ecf96f3-7b09-45e2-825d-1baf46440e7a`; isi project admin itu yang diganti. Template tidak bergantung langsung pada lifecycle project pelanggan.
- Hasil akhir berisi 11 sample, 12 sample mapping, 12 MIDI sequence, 12 preset, dan 22 interface control. Sebelas metadata aset admin memakai object R2 yang sama secara shared; seluruh object diverifikasi ada dan ukurannya cocok, total `6.657.338` byte.
- `_ready_build_spec(..., require_uploaded=True)` lulus dengan 11 sample, 12 sampler-map, 12 MIDI sequence, dan 22 interface control. Katalog publik tetap menampilkan nama serta thumbnail yang benar; ID template, source project ID, thumbnail Cloudinary, sort order `16`, dan setting featured tidak diganti.
- Project pelanggan sumber tidak diubah. Tidak ada build/job pelanggan aktif pada kedua project sebelum mutasi, dan tidak ada build, artifact, kredit, atau job pelanggan yang dibuat maupun diubah.
- Snapshot rollback BSON+metadata tersedia di `/home/triplesidestudio/tripleside/backups/vst-template-neonpopdrums-before-20261023T031340Z` untuk template, settings, kedua project, dan aset terkait.

## SELESAI 2026-10-23 — feedback Button dan Mechanical Toggle Generated Pattern pada build Windows

- Build Windows Arctic Macro Synth terbaru `0ab567ac-18cd-4954-9706-929bb6d9e38a` selesai sukses sebelum perbaikan ini, tetapi Button `Capsule LED Label` dan `Mechanical Toggle` yang dipautkan ke Generated Pattern tampak tidak dapat dioperasikan.
- Akar masalah berada pada jalur renderer shared visual Windows: klik sudah mengubah `livePatternSequence`, tetapi sprite dua-frame masih membaca parameter persisten kontrol (`space`/`solo`). Khusus pad pola, nilai itu juga ditimpa lagi oleh state note pad biasa. Jalur fallback Windows dan renderer macOS sudah membaca state Live Trigger yang benar.
- `drawVisualControl` Windows sekarang memprioritaskan kecocokan `midiSequenceIndex` dengan `livePatternSequenceIndex`; override note pad hanya berlaku pada pad tanpa binding pola. Tombol/toggle langsung memperlihatkan arm/disarm dan Round LED sumber mengikuti state transient yang sama.
- Commit `d7839a0` sudah di-push. Tes fokus `86 passed`, native penuh `133 passed`, dan `git diff --check` bersih.
- Smoke Windows run `39891868974` lulus compile, packaging, install/uninstall; artifact `12474819043`, digest `sha256:950d912349d99644bb682e1f494ce3513f54255382677ad6f80417622cb1076d`.
- Worker menerima overlay terbatas `native-vst3/Source/NativeView.cpp` setelah active builds dan jobs dipastikan `0`; backup `C:\TripleSideWorker\backups\live-pattern-buttons-before-20261023T025520Z`; hash cocok, task kembali `Running` dengan satu proses PID `5380` dan jobs `0`.
- Pipeline revision production dinaikkan ke `live-pattern-control-state-v1`; backend PM2 online, API lokal/publik sehat, Nginx valid, dispatcher macOS enabled/active, dan audit akhir active customer builds `0`.
- Build `0ab567ac...` tetap immutable dan tidak diperbarui diam-diam. Pengguna perlu menjalankan Rebuild Windows berikutnya untuk memperoleh fix; tidak ada job pelanggan yang dibuat, diklaim, diulang, dibatalkan, atau diubah.

## SELESAI 2026-10-23 — kegagalan verifier Arctic pada LED yang ditautkan ke Generated Pattern

- Build Windows Arctic Macro Synth `103a123a-2994-463a-af6b-3c539eb4dbbc` gagal pada verifier komposisi visual, bukan compiler: `3.513` piksel di atas toleransi dan hanya `99,4639587%` cocok, di bawah ambang `99,8%`.
- Akar masalahnya adalah Round LED `6486a54f...` ditautkan ke Mechanical Toggle `a4801b79...`, sedangkan tombol tersebut ditautkan ke Generated Pattern. Browser/native memulai pilihan pola dalam state transient OFF, tetapi verifier lama membaca nilai kontrol persisten `100` dan merekomposisi LED sebagai ON.
- Renderer build sekarang memetakan `midi_sequence_id` serta `generator_config` dan dapat membentuk frame pola OFF/ON secara eksplisit. Verifier memperlakukan tombol/pad pola beserta LED sumbernya sebagai transient OFF sampai pola benar-benar diaktifkan.
- Reproduksi dari immutable `spec_snapshot` job gagal terhadap renderer production lulus `99,97741699%` idle dan `99,96353149%` active. Frontend penuh `222 passed`, native penuh `133 passed`, tes fokus awal `52 passed`, optimized staging build lulus, dan `git diff --check` bersih.
- Commit `0dc84a6` sudah di-push. Frontend dipasang melalui swap atomik; backup rollback `/home/triplesidestudio/tripleside/frontend/build-backup-20261023T004049Z-before-arctic-pattern-led-fix`. Bundle/hash live tercatat pada kondisi saat ini; API lokal/publik sehat, PM2 online, dan Nginx valid.
- Worker Windows menerima overlay terbatas `native-vst3/tools/verify_visual_assets.py` setelah active builds dan jobs dipastikan `0`; backup `C:\TripleSideWorker\backups\arctic-pattern-led-before-20261023T0042Z`; task kembali Running dengan satu proses PID `4968` dan jobs `0`. macOS menggunakan commit `main` terbaru; dispatcher enabled/active dan workflow aktif `0`.
- Job gagal tetap `failed`, attempts tetap `1`, dan `credit_refunded: true`. Tidak ada job pelanggan yang dibuat, diklaim, diulang, dibatalkan, atau diubah; audit akhir active customer builds `0`.

## SELESAI 2026-10-22 — sinkronisasi penuh worker dan builder Windows/macOS

- Audit 62 file runtime/build menemukan worker Windows masih memakai `LicenseRuntime.cpp/.h` versi sebelum dukungan macOS, belum memiliki asset `regent-white-wing-knob-64x128-v1.png`, belum membawa `NativeViewMac.mm`, dan wrapper remote belum mengirim `target_platform: windows`. Seluruh perbedaan sudah dioverlay terbatas setelah active customer builds dan jobs dipastikan `0`; audit hash akhir `62/62` identik.
- Backup rollback worker: `C:\TripleSideWorker\backups\full-parity-before-20261022T190036Z`. Worker kembali `Running`, tepat satu proses PID `4400`, jobs `0`.
- Smoke langsung pada mesin worker production memakai source dan toolchain aktual lulus visual capture/verifier (`99,9963121%` idle, `99,9953416%` active), compile MSVC, Steinberg validator `47 passed, 0 failed`, packaging, install, serta uninstall. Artifact internal SHA-256 `05ae834d8511afda2f3374cacf3579feda30a9e7731de2b232a8ada3bab1d485`.
- Matrix lokal 10 fixture lulus export dan compile manifest: sampler, synth, effect rack, amp/cabinet, creative effects, analyzer, panel, keyboard berwarna, dan visual controls. Capture/verifier production untuk keyboard/LED/waveform, panel, MixForge, dan Wave Generator semuanya lulus di atas ambang `99,8%`; analyzer `native_live` divalidasi melalui runtime/native tests.
- Frontend penuh `222 passed`, backend VST `186 passed`, native penuh `132 passed`, dan kontrak lisensi publik `3 passed` (`6 skipped` karena tes mutatif memerlukan kredensial). Tiga mock lifecycle lama diperbarui agar mencerminkan perlindungan shared storage/template; konteks retry cleanup impulse sekarang dilabeli `VST impulse`, bukan `VST sample`.
- Smoke GitHub commit `5832734` lulus Windows run `39836558883` dan macOS Universal run `39836558853`, keduanya termasuk install/uninstall. Artifact/digest tercatat pada bagian kondisi saat ini.
- Pipeline revision production dinaikkan ke `full-worker-parity-v1` agar Export/Rebuild berikutnya tidak memakai ulang artifact baseline lama. PM2 online, API lokal/publik sehat, Nginx valid, bundle frontend live/lokal identik, dan browser production customer-simulasi merender Designer/Export dengan root terisi serta runtime error `0`.
- Tidak ada job pelanggan yang dibuat, diklaim, diulang, dibatalkan, atau diubah. Audit akhir active customer builds `0`; artifact pelanggan lama tetap immutable.

## SELESAI 2026-10-22 — Arctic memakai alur shared rack Synth test

- Arctic tidak lagi memiliki jalur audio dry terpisah. Semua Wave Generator kini selalu memakai shared AudioWorklet graph yang sama dengan Synth test; project tanpa modul post-DSP memakai plan kosong sebagai identity processor.
- Worklet dipanaskan sejak Wave Generator tersedia, aktivasi pending menerima plan kosong, serta plain note dan Pattern Lab memakai lifecycle graph yang sama.
- Browser production terautentikasi/simulasi membuktikan Arctic membuat tepat satu AudioWorklet dengan `plan: []`, memainkan dan melepas C4, root terisi, serta runtime error `0`.
- Commit `5832734` sudah di-push. Tes fokus `38 passed`, optimized staging build lulus, bundle live `main.0f4ac74f.js`, dan hash publik/lokal cocok.
- Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T181627Z-before-arctic-shared-rack`.

## SELESAI 2026-10-22 — release preview disamakan dengan native

- Capture produksi memastikan voice Arctic berhenti sekitar 246 ms setelah key-up. Perbedaan envelope tersisa: browser memakai ramp eksponensial ke floor sehingga mayoritas level dry lenyap pada awal release, sedangkan native Windows/macOS menurunkan envelope secara linear sampai nol.
- Browser sekarang memakai release linear penuh ke nol seperti native. Gate keluaran 12 ms terakhir tetap aktif sehingga hasil perkalian kedua ramp memiliki ujung zero-slope sebelum oscillator dihentikan.
- Commit `00347ce` sudah di-push. Tes fokus `38 passed`, optimized staging build lulus, bundle live `main.a127dfde.js`, hash publik/lokal cocok, dan API publik sehat.
- Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T181005Z-before-arctic-linear-release`.

## SELESAI 2026-10-22 — penyamaan jalur ringan Arctic dengan Synth test

- Perbandingan project tersimpan membuktikan oscillator/release Arctic dan Synth test hampir sama. Perbedaan penting: Synth test memakai shared DSP rack, sedangkan Arctic tanpa rack masih membuat Biquad, WaveShaper, Convolver, Delay, Chorus, dan feedback graph per voice walaupun seluruh legacy effect OFF.
- Jalur Arctic tanpa rack sekarang benar-benar langsung: oscillator mix → synth filter → tone filter → amp envelope → master/release gate → output. Seluruh node stateful ditempatkan sebelum amp envelope dan graph efek legacy per-voice dihapus.
- Commit `8c6d84e` sudah di-push. Tes fokus `38 passed`, optimized staging build lulus, bundle live `main.fc20bb4f.js`, hash publik/lokal cocok, API publik sehat, dan Nginx valid.
- Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T180254Z-before-arctic-direct`.

## SELESAI 2026-10-22 — klik akhir release Arctic Synth

- Fade sebelumnya hanya berada pada `ampGain`, sedangkan tone filter/effect per-voice berada sesudahnya. State filter yang masih tersisa dapat terpotong ketika source/graph dibersihkan dan terdengar sebagai klik tepat saat nada mati.
- Setiap voice sekarang memiliki `releaseGate` paling akhir setelah seluruh pemrosesan per-voice. Gate tetap terbuka selama release musikal, turun linear ke nol pada 12 ms terakhir, lalu oscillator baru dihentikan setelah zero tail dan padding.
- Jalur tanpa rack, rack aktif, serta perpindahan direct sementara ke shared rack memakai gate akhir yang sama. Native Windows/macOS tidak memerlukan perubahan: filter native sudah dikalikan envelope sesudah pemrosesan dan voice dihentikan pada sampel nol.
- Commit `a6e7707` sudah di-push. Frontend penuh `222 passed`, optimized staging build lulus, bundle live `main.03aade4d.js`, hash publik/lokal cocok, API publik `status: ok`, Nginx valid, dan dispatcher macOS enabled/active.
- Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T175345Z-before-arctic-release-gate`.

## SELESAI 2026-10-22 — koreksi regresi hit pad pada note-off

- Regresi `d52d750` berasal dari efek gabungan `externalPressed || externalTrigger > 0`: counter trigger bersifat persisten, sehingga perubahan `externalPressed` menjadi false saat note-off tetap memenuhi kondisi dan menyalakan flash lagi.
- Status pressed dan revision event sekarang diproses oleh efek terpisah. Revision dibandingkan dengan nilai terakhir sehingga hanya note-on revision baru yang memicu flash; note-off, render ulang, dan remount tidak memicu pad lama.
- Commit `fee49a7` sudah di-push. Tes fokus `62 passed`; bundle live `main.ff10d202.js`; hash publik/lokal cocok; browser production `200`, root terisi, error `0`; API/Nginx sehat; active customer builds `0`.
- Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T1740Z-before-hitpad-edge-fix`.

## SELESAI 2026-10-22 — klik note-off Synth dan retrigger Neon Drum

- Akar klik saat nada Arctic Synth berhenti: release eksponensial lama hanya turun sampai `0.0001`, lalu oscillator dihentikan ketika sinyal masih nonnol. Release sekarang turun ke floor tersebut, dilanjutkan tail linear 5 ms ke nol mutlak, lalu source baru dihentikan setelah padding 5 ms. Jalur ini dipakai nada polos maupun Live Trigger `1 Chord`.
- Akar hit pad Neon hanya menyala sekali: visual memakai `Set`/boolean pitch aktif, sehingga note-on kedua dengan pitch sama tidak menghasilkan perubahan state. Setiap note-on kini menaikkan revision per pitch dan hit effect melepas kelas aktif selama satu paint sebelum menyalakannya kembali bila hit berikut datang saat flash 115 ms masih berjalan.
- Scheduler MIDI sekarang menyimpan token note dengan pitch/channel sama sebagai antrean FIFO. Note-off melepaskan token tertua dan tidak lagi mematikan note retrigger terbaru; cleanup token sustain juga diperbaiki.
- Commit `d52d750` (`Remove synth note-off clicks and retrigger MIDI pads`) sudah di-push ke `main`.
- Verifikasi: frontend penuh `223 passed`, tes fokus akhir `33 passed`, `git diff --check` bersih, optimized staging build lulus, dan browser staging serta production merender Designer dengan root terisi dan console/runtime error `0`.
- Frontend live memakai `main.d410dd04.js`; SHA-256 publik/lokal sama: `c3c96d4a4c9e8c97863185bccff94f12dccf432e3bbfa3adc03bb5536ad6058a`. CSS tetap `main.19d06453.css`.
- Backup rollback sebelum perubahan: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T1726Z-before-noteoff-hitpad`. Backup bundle perantara juga tersedia di `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T1730Z-intermediate-noteoff-hitpad`.
- API publik `status: ok`, Nginx valid, permission build `775`, dan audit akhir active customer builds `0`. Backend/native/worker serta job pelanggan tidak diubah.

## SELESAI 2026-10-22 — de-click preview Synth polos dan 1 Chord

- Akar klik Arctic bukan preset atau DSP rack, melainkan jalur keyboard polos serta Live Trigger `1 Chord` yang memulai oscillator tepat pada `AudioContext.currentTime`; scheduler generator lain sudah memiliki prewarm dan start delay sehingga tidak terkena masalah ini.
- Nada polos sekarang dijadwalkan 12 ms ke depan setelah seluruh waveform/noise selesai disiapkan. Oscillator, filter, dan amp envelope memakai satu timestamp yang sama; note-off yang tiba sebelum start membatalkan envelope secara aman pada silent floor.
- Seluruh voice `1 Chord` memakai satu timestamp audio bersama dengan headroom 20 ms agar triad/seventh tetap sample-aligned setelah graph tiap voice dibuat. Release chord kembali mengikuti release preset, bukan forced release 5 ms.
- Commit `6103cb46ab76f5d04df93e80d4a5b6479fb7abf5` (`Remove clicks from direct synth preview`) sudah di-push ke `main`.
- Verifikasi: frontend penuh `220 passed`, optimized staging build lulus, dan `git diff --check` bersih. Lima cold-run browser staging berturut-turut mengukur plain headroom tepat 12 ms, tiga voice chord dengan spread start `0 ms`, release chord sekitar `259,7 ms`, root terisi, dan runtime error `0`.
- Frontend dipasang melalui swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T1714Z-before-wave-direct-declick`. Browser production memuat `main.39a7655f.js`, Designer ter-render, direct headroom 12 ms, dan runtime error `0`; hash JS/CSS live sama dengan lokal.
- Perubahan hanya frontend. Backend tidak direstart, worker Windows/macOS tidak diubah, dan audit sebelum/sesudah deployment active customer builds `0`; tidak ada job pelanggan yang dibuat atau diubah.

## SELESAI 2026-10-22 — nada Synth Test menggantung pada overlap mono

- Laporan pengguna direproduksi memakai konfigurasi tersimpan project `Synth test`: Sustain OFF, Mono ON, Retrigger ON. Urutan C4 down, E4 down, C4 up, E4 up dalam satu tick meninggalkan satu voice audio orphan; 4 oscillator/LFO dibuat, hanya 2 berakhir, dan blur tidak dapat menghentikan 2 sisanya.
- Akar masalah: retrigger menjadwalkan voice lama berhenti tetapi membiarkannya sementara di `activeWaveVoicesRef`. Note-off tuts lama kemudian memindahkan voice yang sedang release ke token fallback dan menimpa entri voice baru. Voice baru hilang dari registry sehingga note-off berikutnya maupun cleanup blur tidak dapat menemukannya.
- Registry mono sekarang dikosongkan secara sinkron dan dideduplikasi sebelum voice retrigger baru dibuat. Pemindahan token fallback mengeluarkan serta menghentikan voice yang tergeser, dan voice yang sudah cleanup/release tidak boleh ditarget ulang.
- Commit `bf987e1acfebb609226138cc44a7aa72f5066dce` (`Fix overlapping mono synth note release`) sudah di-push ke `main`.
- Verifikasi: frontend penuh `218 passed`, focused `34 passed`, optimized staging build lulus, dan `git diff --check` bersih. Browser staging dan production menguji lepas tuts lama dulu, lepas tuts baru dulu, tiga nada dengan urutan release campuran, serta kehilangan key-up saat blur. Semua skenario berakhir `alive: 0`, root React tetap terisi, dan console/runtime error `0`.
- Frontend dipasang dengan swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T1642Z-before-synth-mono-release`.
- HTML/JS/CSS publik `200`, hash aset live/lokal cocok, API lokal/publik sehat, PM2 online, dan Nginx valid. Audit sebelum deployment active customer builds `0`; tidak ada backend/native/worker atau job pelanggan yang dibuat maupun diubah.

## SELESAI 2026-10-22 — stabilitas preview synth dan Button Live Trigger

- Akar WAV yang tidak terunggah pada project Arctic: tiga `PUT` metadata project ditolak `422`; karena `saveProject()` baru menjalankan upload sample setelah metadata sukses, tidak ada request upload WAV yang sempat dimulai. Schema production sekarang menerima `midi_sequence_id`; data/job pelanggan tidak dimutasi untuk diagnosis.
- Preview Wave Generator kini membatasi registry voice menurut polyphony project, mencuri released/voice tertua saat batas tercapai, dan membersihkan voice berdasarkan identitas. Ini menutup penumpukan node Web Audio serta stale token setelah retarget mono yang menyebabkan preview Synth test berhenti/crash.
- Dropdown Button/Pad hanya menampilkan Generated Pattern. Klik komponen meng-arm Live Trigger alih-alih langsung memainkan pitch absolut. LED/visual state mengikuti pola yang di-arm.
- Compiler menyimpan trigger root dan mode held-chord. Runtime Windows/macOS mentransposisi event pola menurut tuts, menskalakan velocity, menghentikan pola saat release, dan mempertahankan mode `1 Chord` sampai tuts dilepas.
- Commit `9166b5c4bae6c0054b574842d47dbfa4a983d662` (`Stabilize synth preview and arm live patterns`) sudah di-push ke `main`.
- Verifikasi: frontend penuh `215 passed`, backend schema/template `78 passed`, native penuh `132 passed`, optimized staging build lulus, dan `git diff --check` bersih. Browser staging dan production sama-sama merender `/vst-studio`, menampilkan Generated Pattern pada Button, meng-arm Live Trigger, mengisi root React, dan menghasilkan console/runtime error `0`.
- Frontend dipasang dengan swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T1534Z-before-live-pattern-button`.
- Worker Windows menerima overlay terbatas empat file source/compiler setelah audit active builds/jobs `0`; hash cocok dan worker kembali sehat. macOS tersinkron melalui GitHub `main`.
- Smoke internal Windows/macOS selesai sukses; tidak ada customer build/job yang dibuat, diklaim, diulang, dibatalkan, atau diubah. Audit akhir active builds `0`.

## SELESAI 2026-10-22 — batas loop mulus dan progression angka

- Klik kecil setiap genap satu putaran bukan perilaku normal. Akar masalahnya adalah cleanup batas loop memanggil release lagi untuk voice yang sudah berada dalam release tail, sehingga gain sempat dinaikkan kembali ke sustain. Guard release sekarang menolak release kedua yang waktunya sama atau lebih lambat, tetapi tetap mengizinkan Stop langsung atau release lebih awal.
- Chord Generator `Progression bebas` memakai contoh angka `1 - 5 - 6 - 4`, menerima angka degree `1–7`, dan mempertahankan string kosong selama pengguna menghapus isi. Jika Generate ditekan saat kosong, fallback progression lama tetap aman; input Romawi tersimpan tetap didukung.
- Commit `b5f7eae33ab57dc431ea6d2feb430e04d876af5e` (`Smooth pattern loops and numeric progressions`) sudah di-push ke `main`.
- Frontend penuh `212 passed`, optimized staging build lulus, dan `git diff --check` bersih. Browser staging/production melewati batas loop 2 detik dengan 20 voice tanpa release yang dimulai ulang, memverifikasi input `1 6 4 5` serta penghapusan sampai kosong, root React terisi, bundle baru termuat, dan console/runtime error `0`.
- Frontend dipasang dengan swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T105550Z-before-loop-progression`.
- Bundle live/lokal: JS `4d786f7fc8af14accd68876a1a340b513b64e8d114fae4394655d1eb681e7b89`; CSS `03db5189d00b3d53c4a42a1e3fecb2337c6b03100084e900606f23d236a3da66`.
- Perubahan hanya frontend; backend dan worker tidak diubah. Audit sebelum dan sesudah deployment active customer builds `0`; tidak ada job pelanggan yang dibuat atau diubah.

## SELESAI 2026-10-22 — de-click preview Pattern Lab Wave Generator

- Akar klik/pecah: scheduler 250 ms sering mengantre note-on dan note-off nada pendek sebelum nada mulai. Jalur release lama membaca `AudioParam.value` pada waktu pemanggilan, masih bernilai default `1.0`, lalu menjadwalkan lonjakan itu pada note-off sebelum ramp release. Pada level nada normal sekitar `0,16–0,29`, lonjakan tersebut menghasilkan klik dan clipping ketika release bertumpuk.
- Release Wave Generator sekarang menghitung level attack/decay/sustain pada timestamp audio note-off yang sebenarnya. Release manual memakai `cancelAndHoldAtTime` bila tersedia, attack nol mendapat fade de-click minimum 3 ms, dan voice tidak lagi dikeluarkan dari registry sebelum seluruh source berakhir sehingga Stop dapat membatalkan event look-ahead.
- Commit `60f4bcaf274ae601528b791f49bf8933148cb903` (`Remove clicks from Wave Generator patterns`) sudah di-push ke `main`.
- Verifikasi: frontend penuh `210 passed`, `git diff --check` bersih, dan optimized staging build lulus. Browser staging serta production menguji Arpeggiator, Step Sequencer, Bassline, dan Melody lewat jalur audio nyata; release terukur `0,164–0,286`, tidak ada release `1,0`, root React terisi, bundle baru termuat, serta console/runtime error `0`.
- Frontend dipasang dengan swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T104345Z-before-wave-pattern-declick`.
- Bundle live/lokal: JS `7af119326a43666c557bed9d3a7ff5861b3ef8b8b1da8accb6fcfcbe784da2d6`; CSS `03db5189d00b3d53c4a42a1e3fecb2337c6b03100084e900606f23d236a3da66`.
- Perubahan hanya frontend; backend tidak direstart dan worker Windows/macOS tidak diubah. Audit sebelum deployment active customer builds `0`; tidak ada job pelanggan yang dibuat atau diubah.

## SELESAI 2026-10-22 — Live Pattern eksklusif, chord bebas, dan preview halus

- Tombol global Live Trigger dipindahkan ke setiap baris Generated Pattern, tepat di sebelah Preview. Hanya satu pola yang dapat aktif; mengubah editor atau membuat pola lain tidak otomatis mengganti pola live.
- Config pembentuk pola disimpan sebagai metadata `generator_config` pada MIDI sequence dan diterima schema backend, sehingga pola tersimpan tetap memiliki mode/config asalnya.
- Chord Generator memiliki mode `1 Chord` dan `Chord Berjalan`. Progression berjalan menerima input bebas degree I–VII/1–7; mode satu chord menawarkan Major, Minor, Major 7, Minor 7, Sus 2, Sus 4, dan Aug. Preview 1 Chord tidak loop, sementara Live Trigger menahannya sampai tuts dilepas.
- Kelancaran Arpeggiator, Step Sequencer, Bassline, dan Melody diperbaiki dengan look-ahead 250 ms, interval feeder 20 ms, prewarm audio/DSP, deduplikasi update plan worklet, dan release terjadwal tepat di batas loop.
- Commit `8148a34d2ce925c6da86541e92ade9f935fa738a` (`Refine live patterns and chord modes`) sudah di-push ke `main`.
- Verifikasi: frontend penuh `207 passed`, backend fokus `158 passed`, `git diff --check` bersih, optimized staging build lulus. Browser staging menguji chord eksklusif serta keempat generator dengan deadline audio 237–247 ms di depan; browser production memuat bundle baru, root terisi, Live Trigger eksklusif, Arpeggiator terjadwal 247,7 ms di depan, dan error `0`.
- Frontend dipasang dengan swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T1017Z-before-pattern-live-chords-smooth`.
- Bundle live/lokal: JS `fc88a4a404f980a7ce7763dc963be6a9aa52de413356db5b9a4301b047b31030`; CSS `03db5189d00b3d53c4a42a1e3fecb2337c6b03100084e900606f23d236a3da66`.
- Backend PM2 direstart agar schema metadata aktif; API lokal/publik sehat dan Nginx valid. 503 hanya terjadi pada detik startup sebelum Uvicorn ready dan pulih otomatis.
- Tidak ada perubahan native pada tugas ini. Worker Windows tidak dioverlay: compiler lokal/remote tetap identik (`bef503ae...afd2`), task Running, satu proses PID `4728`, jobs `0`. macOS tersinkron lewat GitHub `main`; dispatcher enabled/active dan workflow aktif `0`.
- Audit sebelum deployment dan audit akhir: active customer builds `0`; tidak ada job pelanggan yang dibuat atau diubah.
- Catatan kesinambungan: jika diminta membuat pilihan Live Trigger ikut bekerja di plugin hasil build, itu adalah pekerjaan native terpisah yang memerlukan schema persistensi pilihan aktif, compiler manifest, dan runtime sequencer Windows/macOS; jangan menganggap fitur preview saat ini sudah melakukan hal tersebut.

## SELESAI 2026-10-22 — Live Trigger dan penghapusan efek kompatibilitas lama

- `Live Trigger ON/OFF` ditambahkan ke Pattern Lab. Keyboard layar dan MIDI controller menjadikan tuts yang ditahan sebagai root pola; release menghentikan transport sementara tanpa menambah MIDI Groove project.
- Khusus Chord Generator, satu tuts memainkan satu triad diatonik yang sustain sampai tuts dilepas. Progression tetap hanya digunakan oleh tombol `Generate`.
- Kartu `Efek kompatibilitas project lama` dihapus. Draft/project tersimpan dimuat dan diserialisasi dengan `effects: {}`; pricing frontend/backend mengabaikan flags lama; build spec mengirim `effects: {}` dan melaporkan supported legacy effects kosong; compiler Windows/macOS memaksa seluruh flag lama false.
- Commit `14464cb1a01512e8675b51cf1d55c515406f0a9f` (`Add live generator trigger and retire legacy effects`) sudah di-push ke `main`.
- Verifikasi: frontend penuh `199 passed`, backend fokus `158 passed`, native penuh `130 passed`, optimized staging build lulus. Browser staging dan production memverifikasi draft lama dibersihkan, kartu lama tidak muncul, C4 Live Chord menghasilkan C–E–G, release berhenti, root React terisi, dan console/runtime error `0`.
- Frontend dipasang dengan swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T0943Z-before-live-trigger`.
- Bundle live/lokal cocok: JS `cd8476c0dcee18831fa8eb875d101f67e8cf6a1fa890c7c6b0f0d55064b2fc29`; CSS `5b964c9ecf5aa402d47f37654b2b764312941ef163188a18499dbea9f92c9596`.
- Backend PM2 online dan pipeline revision `live-trigger-no-legacy-effects-v1`; API lokal/publik sehat dan Nginx valid.
- Worker Windows menerima overlay terbatas `compile_manifest.py`; backup `C:\TripleSideWorker\backups\legacy-effects-before-20261022T0944Z`; hash cocok, task running, satu proses PID `4728`, jobs `0`. Dispatcher macOS enabled/active dan GitHub `main` memakai commit terbaru.
- Smoke Windows run `39757679879` lulus build serta install/uninstall; artifact `12416372421`, digest `sha256:81f893c5b3c49dfc92a75e3297095bb14b5b42766699c720112beec8f9e1a2e1`. Smoke macOS Universal run `39757680044` lulus arm64+x86_64 serta install/uninstall; artifact `12416885999`, digest `sha256:4edf053e3a4acc2de028afa81fd8df278a0ee6133a4646db0fbc5bec35a75518`.
- Audit akhir active customer builds `0`, jobs worker `0`, dan tidak ada workflow aktif. Tidak ada job pelanggan yang dibuat atau diubah; artifact lama tetap immutable.

## SELESAI 2026-10-22 — Wave Generator Pattern Lab

- Menambahkan lima pembuat pola di editor Wave Generator: Arpeggiator, Chord Generator, Step Sequencer, Bassline Generator, dan Melody Generator.
- Semua mode memiliki root, scale, octave, tempo, panjang 8/16/32 step, dan gate. Kontrol khusus meliputi direction/chord/range arpeggiator, progression chord, note degree per-step, style bassline, serta contour/range/density melody.
- Hasil disimpan sebagai MIDI sequence standar project, Loop aktif, muncul di generated pattern/MIDI Grooves, serta memiliki Preview/Stop khusus Wave Generator agar tidak tercampur sampler.
- Scheduler preview memakai waktu Web Audio terjadwal dan memaksa poly untuk pattern sehingga chord tidak terpotong oleh voice mode mono manual.
- Commit `0f885a7634c4cf66a363063fc3f20f0ea7c809fe` (`Add Wave Generator pattern tools`) sudah di-push ke `main`.
- Frontend penuh `194 passed`, backend VST queue/spec/worker `148 passed`, native penuh `130 passed`, optimized staging build lulus.
- Browser smoke staging dan production sama-sama menguji kelima mode, Generate, Preview, Stop, root React tidak kosong, serta `0` console/runtime error.
- Frontend dipasang dengan swap atomik. Backup rollback: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T033623Z-before-wave-patterns`.
- Bundle live/lokal cocok: JS `c552da59d18537a8de69a963ae176ce0a39e758c5fbb5e8cc5914b97bc3f3626`; CSS `d9c400a0cb8f900029fc1ee576084ed594c6df5c9ec1269b64eb496010673fb2`.
- Tidak ada perubahan native baru pada fitur ini. Worker Windows diverifikasi identik untuk seluruh source/compiler terkait; macOS memakai GitHub `main` terbaru. Tidak ada customer build/job yang dibuat atau diubah.

## SELESAI 2026-10-22 — parity skala keyboard dan Mechanical Toggle synth

- Laporan terakhir direproduksi dari immutable spec snapshot build Windows Arctic Macro Synth `79f836c1-6806-47d1-8786-a00a8cfc33a5`; tidak ada customer build/job yang dibuat atau diubah.
- Akar keyboard: atlas memakai sel maksimum tuts putih `40×127`, tetapi source tuts hitam hanya `31×85`; native membaca seluruh sel sehingga artwork hitam terkompresi kedua kali. Manifest kini menyimpan `source_width/source_height` per tuts dan Windows/macOS hanya membaca area source aktual. Rasio DOM Arctic tetap sekitar `62%` lebar/tinggi.
- Renderer macOS sekarang menggambar frame idle maupun pressed untuk seluruh tuts dan hit-test menggunakan urutan terbalik agar tuts hitam yang dilukis di atas mendapat prioritas seperti Windows.
- Akar Mechanical Toggle: Arctic adalah instrument tetapi toggle memakai parameter global `bypass`; runtime instrumen belum mendaftarkan `kBypassId`, sehingga klik tidak memiliki state native. Parameter kini didaftarkan bila dipakai, dipersistenkan pada state v6 dengan kompatibilitas state lama, dan membypass hanya rantai DSP sambil mempertahankan dry synth serta smoothing.
- Reproduksi capture Arctic lulus verifier `99,9783325%` idle dan `99,9644470%` active. Toggle memiliki dua frame nyata dengan `2.983` piksel berubah.
- Commit `073aff4430ebbaf3fb58d54c59017515ff5972a2` (`Fix native keyboard atlas and synth toggle`) sudah di-push; native penuh `130 passed`, backend queue/spec/worker `72 passed`, dan `git diff --check` bersih.
- Smoke Windows run `39712103025` lulus build serta install/uninstall; artifact `12397483286`, digest `sha256:f6c644df49badbfa6692789fd7280012efdd7111243406a276c008e4ee1cfa42`. Smoke macOS Universal run `39712102878` lulus arm64+x86_64 serta install/uninstall; artifact `12397682984`, digest `sha256:fbf4b9672191a95cc471ee8914017bf19f8699d794308c5bc718de2f32cc6958`.
- Worker Windows menerima overlay terbatas `NativeInstrument.cpp`, `NativeView.cpp`, `NativeView.h`, `compile_manifest.py`, dan `render_visual_assets.py`; hash remote identik dengan VPS. Backend live memakai pipeline revision `keyboard-atlas-toggle-v1`, sehingga build berikutnya tidak memakai ulang artifact revision lama.
- Artefak Arctic yang lama tetap immutable. Pengguna perlu menjalankan build/rebuild Windows baru untuk memperoleh perbaikan; jangan enqueue otomatis.

## SELESAI 2026-10-22 — Realtime Waveform dan Round LED Indicator

- `Realtime Waveform` ditambahkan ke kategori Spektrum, bergerak dari data time-domain audio secara real time dan warnanya dapat diubah.
- `Round LED Indicator` adalah lampu bulat polos dengan warna yang dapat diubah, mode manual nyala/mati, dan tautan state ke komponen lain. LED tidak mengambil interaksi mouse sendiri.
- Save/load project, schema backend, validasi referensi indikator, compiler manifest, atlas dua-frame LED, verifier visual, runtime Windows, dan runtime macOS sudah diselaraskan.
- Validasi akhir: frontend fokus `32 passed`, backend VST `148 passed`, native penuh `128 passed`. Browser smoke staging dan production merender Designer tanpa console/runtime error.
- Verifier visual production lulus `99,9935947%` idle dan `99,9934006%` active. Atlas LED memiliki dua frame dengan `9.262` piksel berubah.
- Frontend dibangun di staging lalu dipasang dengan swap atomik. Backup: `/home/triplesidestudio/tripleside/frontend/build-backup-20261022T014513-before-waveform-led`.
- Saat swap, direktori staging membawa mode `700` dan endpoint publik sempat membalas `403`; mode live segera diperbaiki menjadi `755`, lalu HTML, JS, CSS, dan browser smoke production kembali lulus. Jangan mengulangi swap tanpa audit permission direktori staging.
- Worker Windows menerima overlay terbatas `NativeView.cpp`, `NativeView.h`, `compile_manifest.py`, `render_visual_assets.py`, dan `verify_visual_assets.py`; hash remote identik dengan VPS. Dispatcher macOS kembali aktif.
- Tidak ada customer build/job yang disentuh atau dibuat selama pekerjaan ini.

## SELESAI 2026-10-22 — pewarnaan tuts build Windows dan macOS

- Commit `155f32859464d855e882ca73ffea8df7b48d8160` (`Deploy colored keyboard native parity`) sudah di-push ke `main`; workflow Windows/macOS sama-sama checkout SHA tersebut.
- `NativeViewMac.mm` sekarang menghitung row/column overlay pressed dari `key.frame + 1`, setara dengan Windows yang memakai `key.frame + (active ? 1 : 0)`.
- Tes kontrak eksplisit menjaga urutan atlas normal lalu aktif, frame dasar `key_index*2`, serta pemilihan frame pressed kedua platform.
- Fixture internal `colored-keyboard-smoke.json` memakai tuts putih pitch 48 berwarna `#FF2D55` dan tuts hitam pitch 61 berwarna `#00D4FF`. Compiler menghasilkan `KeyColorInfo{1, 48, 0xFF2D55}` dan `KeyColorInfo{1, 61, 0x00D4FF}`.
- Capture melalui endpoint visual production menghasilkan frame 14→15 untuk pitch 48 dan 78→79 untuk pitch 61; beda piksel idle/pressed nyata. Verifier lulus `99,9963%` idle dan `99,9953%` active within tolerance.
- Validasi lokal: backend save/build spec `110 passed`, backend queue/worker/spec `71 passed`, frontend fokus `31 passed`, native penuh `125 passed`, workflow YAML/JSON dan `git diff --check` lulus.
- Smoke Windows run `39704920606` lulus build serta install/uninstall; artifact `12394602346`, digest `sha256:1b8397068189467d363e0833ded2637608bc774b554b37b14319f2af61e71123`.
- Smoke macOS Universal run `39704920671` lulus arm64+x86_64 serta install/uninstall; artifact `12394622032`, digest `sha256:9c6926454ae4f04cdf7f3333a40e947f2e583da72fc8c3ee4d835bc8486295f4`.
- Worker Windows menerima overlay terbatas `NativeView.cpp`, `NativeView.h`, dan `compile_manifest.py`; backup `C:\TripleSideWorker\backups\keyboard-key-color-before-20261022T012259Z`. Hash remote/lokal cocok, task kembali `Running`, satu proses PID `5784`, jobs `0`.
- Backend production direstart dengan pipeline revision `keyboard-key-color-parity-v1`; PM2 online, API lokal/publik `status: ok`, Nginx valid, dispatcher macOS user timer enabled/active, active builds `0`.
- Tidak ada job pelanggan yang dibuat, diklaim, diulang, dibatalkan, atau diubah. Artefak lama tetap immutable; pengguna harus menjalankan build/rebuild baru untuk memperoleh hasil ini.

## Perubahan terbaru — persistensi warna per tuts saat save/load project

- Akar masalah: frontend sudah mengirim dan membaca `key_colors`, tetapi proses backend production masih berjalan dari sebelum field tersebut ditambahkan. Respons simpan tidak membawa warna tuts dan frontend kemudian mengganti state lokal dengan respons server, sehingga warna menghilang.
- Schema backend `VstMakerInterfaceControlInput.key_colors` sekarang aktif di production setelah restart PM2 pada 2026-10-21 13:09 UTC. API lokal dan publik mengembalikan `status: ok`; PM2 online dan Nginx valid.
- Tes regresi memastikan warna tuts yang dinormalisasi tetap ada pada `VstMakerProjectInput.model_dump()`, yaitu bentuk dokumen yang disimpan ke MongoDB.
- Backend VST tests: `110 passed`; frontend test fokus: `31 passed`.
- Audit sebelum restart: active customer builds `0`. Database memiliki 9 project berkontrol keyboard dan belum ada project dengan `key_colors` non-kosong, sehingga warna yang hilang sebelum perbaikan tidak dapat direkonstruksi otomatis; pengguna perlu memilih warnanya kembali lalu menyimpan project.
- Tidak ada build/job pelanggan yang dibuat, diklaim, diulang, dibatalkan, atau diubah. Perbaikan ini hanya mengaktifkan persistensi project; worker Windows/macOS belum disinkronkan dalam pekerjaan ini.

## INSIDEN FATAL 2026-10-21 — downtime build live dan layar hitam VST Studio

- Kesalahan ini dibuat oleh Codex dan dinilai fatal oleh pengguna. Jangan mengecilkan dampaknya atau mengulang pola yang sama.
- Kesalahan pertama: `npm run build` dijalankan dengan output default langsung ke `frontend/build`, padahal Nginx melayani folder tersebut sebagai production live. Create React App mengosongkan folder output sebelum menulis bundle baru. Selama proses itu `index.html` hilang, sehingga production sempat membalas `403 directory index forbidden` dan `rewrite or internal redirection cycle`.
- Kesalahan kedua: hot path authenticated VST Studio tidak diuji dengan browser sebelum bundle dipasang. Ekspresi berikut salah ketika kedua objek belum ada: optional chaining menghasilkan `undefined === undefined` yang bernilai benar, lalu kode membaca `.pitch` dari `null` dan meruntuhkan seluruh React root menjadi layar hitam:
  - Salah: `keyboardColorSelection?.controlId === selectedControl?.id && selectedKeyboardPitches.includes(keyboardColorSelection.pitch)`
  - Benar: wajib pastikan `keyboardColorSelection` truthy sebelum membaca properti berikutnya.
- Optimized build yang sukses dan tes berbasis pencarian string tidak membuktikan halaman dapat dirender. Keduanya lulus tetapi tetap melewatkan crash runtime ini.
- Reproduksi browser terautentikasi/simulasi menemukan error nyata: `TypeError: Cannot read properties of null (reading 'pitch')`; `#root` kosong.
- Pemulihan: null guard diperbaiki, test fokus `31 passed`, bundle dibuat di folder staging terpisah, diuji dengan browser customer simulasi, lalu dipasang melalui rename atomik. Bundle live `main.1ffd7707.js`; browser smoke production menunjukkan Designer ter-render, `#root` berisi, dan `0` console/runtime error.
- Backup rollback sebelum hotfix dipertahankan di `frontend/build-backup-20261021T1259-before-keycolor-hotfix`.

### Aturan pencegahan wajib setelah insiden

1. **DILARANG menjalankan build frontend dengan output default pada host production.** Di host ini `frontend/build` adalah direktori live; menjalankan `npm run build` biasa adalah mutasi/deployment production, bukan sekadar validasi lokal.
2. Untuk validasi/deployment, selalu gunakan folder staging eksplisit, misalnya `BUILD_PATH=build-staging-<task> npm run build`. Pastikan target staging belum ada dan jangan arahkan build ke `frontend/build`.
3. Sebelum swap, jalankan browser smoke terhadap folder staging untuk rute yang benar-benar terdampak. Untuk VST Studio, smoke wajib masuk ke state customer/admin (boleh memakai API interception simulasi), memastikan `#root` tidak kosong, teks Designer muncul, dan jumlah console/runtime error `0`.
4. Perubahan state nullable wajib diuji pada initial render sebelum interaksi apa pun. Jangan mengandalkan optional chaining di sisi kiri perbandingan bila hasil `undefined` dapat sama dengan nilai lain yang juga `undefined`.
5. Tes source-string, unit test, dan optimized build tetap dijalankan, tetapi tidak boleh menggantikan runtime browser smoke untuk halaman authenticated atau data-dependent.
6. Deployment frontend harus memakai swap atomik yang dapat di-rollback: validasi staging, rename `build` lama ke backup bertanggal, rename staging ke `build`, lalu jangan hapus backup sampai verifikasi selesai.
7. Setelah swap, verifikasi dari domain publik: HTML `200`, hash bundle live cocok dengan staging, JS/CSS `200`, API `status: ok`, Nginx valid, dan browser production memuat nama bundle baru tanpa console error.
8. Jika `#root` kosong atau layar hitam, rollback segera ke backup terakhir; jangan meminta pengguna berulang kali refresh sebelum runtime error diperiksa.
9. Jangan mengatakan “belum deploy” setelah menjalankan build default di host ini. Karena output default adalah folder live, perintah tersebut sudah memengaruhi production walaupun tidak ada restart Nginx.

## Perubahan terbaru — penyempurnaan kartu Kesiapan Build dan dropdown unduhan

- Kartu Kesiapan Build diberi jarak tambahan dari tab `FX & Processor`, sementara label `siap` dan daftar pemeriksaan di bawah indikator diperbesar agar lebih mudah dibaca.
- Lingkaran pada kondisi 100% sekarang memakai palet biru yang sama dengan progress bar build (`#0284c7`, `#38bdf8`, `#7dd3fc`) dengan glow yang lebih lembut.
- Layer pembungkus dan menu `Unduh build terakhir` dinaikkan serta latar menu dibuat solid agar teks dari elemen di belakang tidak menembus atau menumpuk pada dropdown.
- Test frontend fokus: `30 passed`; optimized production build lulus.
- Frontend production sudah memakai bundle baru dan SHA-256 JS/CSS live cocok dengan lokal. API lokal/publik tetap `status: ok`; PM2 online; Nginx valid.
- Audit akhir active customer builds `0`; tidak ada backend/native/worker atau job pelanggan yang dibuat maupun diubah. Source CSS/test terkait tetap mengikuti baseline untracked yang disengaja dan belum di-commit.

## Perubahan terbaru — tombol Export dan Rebuild diringkas

- Empat tombol platform terpisah pada header Designer diganti menjadi satu tombol `Export` ringkas yang membuka pilihan `Export Windows` dan `Export macOS`.
- Tombol `Rebuild` hanya muncul untuk customer ketika minimal satu platform masih memiliki slot Rebuild Koreksi. Menu menampilkan Windows dan macOS; platform tanpa slot tetap terlihat tetapi disabled dengan status `Slot tidak tersedia`.
- Menu menutup setelah platform dipilih, saat klik di luar, atau ketika `Escape` ditekan. Alur quote, lisensi, biaya, penyimpanan project, dan antrean build tetap memakai fungsi yang sama.
- Commit: `03ef975cc61a8f67ef6a17e285def19dd8bf3cb5` (`Compact VST build platform actions`). Test frontend fokus: `49 passed`; optimized production build lulus.
- Frontend production sudah memakai bundle baru dan SHA-256 JS/CSS live cocok dengan lokal. API lokal/publik tetap `status: ok`; Nginx valid.
- Audit akhir: active customer builds `0`; worker Windows task `Running`, satu proses wrapper aktual PID `3976`, dan job files `0`. Tidak ada backend/native/worker yang diubah dan tidak ada job pelanggan yang dibuat atau diubah.

## Perubahan terbaru — toolbar kanvas Designer diringkas

- Tombol Undo dan Redo dipindahkan dari baris aksi utama menjadi dua tombol ikon ringkas tepat di kanan grup Snap Grid; shortcut keyboard dan state disabled tetap berfungsi.
- Teks bantuan `Ctrl/Cmd + D`, status/dimensi background, instruksi drag/resize, tombol `Reset ukuran`, serta pesan inspector ketika tidak ada kontrol terpilih dihapus sesuai permintaan.
- Commit: `02db6458fe4394aadefdce9df886ec287898625b` (`Reorganize VST designer canvas toolbar`). Test frontend fokus: `30 passed`; optimized production build lulus.
- Frontend production memakai bundle baru dengan checksum JS/CSS live yang sama dengan lokal; API publik tetap `status: ok`.

## Perubahan terbaru — header Designer tidak menimpa navbar

- Akar masalah: `.maker-designer-heading-row`, yang memuat judul `Plugin & VST Designer` sampai tombol Export, memiliki stacking layer `60`, sedangkan navbar/logo TripleSide Studio berada pada layer `50`. Saat discroll, header Designer karena itu dirender di atas navbar.
- Seluruh stacking context header Designer diturunkan ke layer `40`, termasuk popup turunannya, sehingga navbar utama selalu menutup area tersebut dengan benar.
- Commit: `f103f451f6eb01fe92fd850ba6c462fcdfb62cd6` (`Keep designer header below site navbar`). Test frontend fokus: `29 passed`; optimized production build lulus.
- Frontend production sudah memakai bundle baru dan checksum JS/CSS live cocok dengan lokal; API publik tetap `status: ok`.

## Perubahan terbaru — builder macOS disetarakan dengan Windows

- Worker macOS sekarang menerapkan guard input yang setara dengan Windows: checksum spec wajib valid, hanya sample WAV diterima, download dibatasi ke HTTPS, background harus berukuran `1..10 MiB`, dan folder kerja lama dibersihkan secara terarah sebelum build.
- Project lama tanpa `visual_contract` kini memakai fallback berbasis kapabilitas yang sama dengan Windows: `prism_eq` memakai `native_live`, sedangkan project lain memakai `shared_preview`.
- Builder macOS memverifikasi binary Universal arm64+x86_64, symbol `GetPluginFactory`, manifest, font, dan setiap resource hasil generate sebelum codesign dan packaging.
- Smoke workflow macOS kini mengekstrak artifact, memasang `.pkg` ke lokasi VST3 sistem, memverifikasi arsitektur/codesign/receipt, menjalankan uninstaller dalam mode smoke noninteraktif, lalu memastikan plugin dan package receipt benar-benar terhapus.
- Commit: `5ae89ac49242c95016037ba4fdc421e6c72ae02f` (`Harden macOS VST builder parity`). Native tests penuh: `123 passed`; validasi syntax shell dan YAML lulus.
- Smoke macOS Universal run `39586509028`: sukses termasuk install/uninstall; artifact `12340760666`, digest `sha256:6dfa4bfa526aa524cf8fdb9726c92a8887a8e88e7872fb0bd447ed598f8455cb`.
- Builder customer macOS checkout `main`, sehingga commit ini langsung menjadi baseline build berikutnya. Audit akhir active customer builds tetap `0`; tidak ada job pelanggan yang dibuat atau diubah.

## Perubahan terbaru — header panel dan drag Mixer yang mulus

- Label instance bernomor seperti `Preset Browser 19` dan `Mixer 16` dihapus dari preview dan runtime native. Header Preset Browser, Mixer, dan Groove Browser kini konsisten: hanya nama tipe panel berwarna accent di pojok kiri atas.
- Akar slider VOL/PAN terasa patah-patah pada native adalah interaksi Mixer hanya mengubah nilai sekali saat `mouseDown`; tidak ada state drag maupun pembaruan saat pointer bergerak.
- Windows dan macOS kini menyimpan group/slot Mixer yang sedang di-drag dan memetakan posisi horizontal mouse secara kontinu ke nilai parameter `0..1`. Area grab diperlebar agar seluruh thumb mudah ditangkap; mouse-up dan penutupan panel selalu mereset state drag.
- Commit: `ea2a195834f23aaba4b1ec929677468e9d932d4a` (`Align panel headers and smooth mixer drag`). Native tests penuh: `121 passed`; frontend test fokus: `28 passed`; backend queue/worker/spec: `70 passed`; optimized frontend build lulus.
- Smoke Windows installer run `39582670532`: sukses termasuk build dan install/uninstall; artifact `12339120338`, digest `sha256:f5ea03429ec34a976c9ba9950b964141da1b086d082e264e7d26bfb7d09107e4`.
- Smoke macOS Universal run `39582674756`: sukses arm64 + Intel; artifact `12339440198`, digest `sha256:a17b7ec1b81446b67579e50518820533e97282177c776765f6337cc003d25bbf`.
- Pipeline revision live dinaikkan menjadi `panel-header-mixer-drag-v2`, sehingga Rebuild berikutnya tidak memakai ulang artifact ready dari revision lama.
- Worker Windows disinkronkan setelah audit active customer builds `0` dan jobs `0`; backup `C:\TripleSideWorker\backups\panel-header-mixer-drag-before-20261021T171202Z`; SHA-256 `NativeView.cpp`/`.h` cocok dan worker kembali tepat satu proses PID `3976`.
- Frontend, backend, dan worker production sudah deployed. Audit akhir tetap menunjukkan active customer builds `0` dan jobs worker `0`; tidak ada job pelanggan yang dibuat atau diubah.

## Perubahan terbaru — kegagalan verifier visual child control Panel Button

- Dua build Windows Neon Pop Rock Drums terakhir `a4d82a32-3ae3-485e-99a9-e07e8c20e63a` dan `dae5d954-91eb-492e-ad6e-70b8ea621b06` gagal pada verifier komposisi visual, bukan compiler C++; keduanya sudah otomatis direfund oleh backend.
- Akar masalah: setelah child control Panel Button mulai diraster, verifier canvas tertutup lama tetap menempelkan lima atlas child Mixer yang hanya semestinya terlihat ketika panel terbuka. Hasilnya `30.518` piksel berbeda dan hanya `95,3433%` berada dalam toleransi, di bawah batas `99,8%`.
- Verifier sekarang menguji canvas tertutup tanpa child control, lalu menguji setiap panel terbuka secara terpisah memakai reference dan backdrop panel. Selector backdrop memakai `.maker-canvas-control.is-panel-child`, sesuai struktur DOM aktual tempat child merupakan sibling panel.
- Reproduksi langsung memakai immutable spec snapshot job `dae5d954...` lulus: canvas tertutup `99,9993896%`, panel Mixer `99,9996948%`, dan active-state `99,9987793%` within tolerance.
- Commit: `b0e47ec560b8d4e735e03d0a74e33712c06df54e` (`Verify panel child visuals separately`). Native tests penuh: `119 passed`; `git diff --check` bersih.
- Smoke Windows installer run `39578273723`: sukses termasuk build, install/uninstall, dan upload artifact `12335900586` (`sha256:853e455dc97f8263090b2316e11716fc8b0fa7d45d53a027e36d6f35a8bcb130`).
- Smoke macOS Universal run `39578278259`: sukses dan upload artifact `12335715956` (`sha256:6cd6092dcda40a4c60773643538f7a28136b6e7e92178d57c634475a5fc183a1`).
- Worker Windows disinkronkan setelah audit active customer builds `0` dan jobs `0`; backup `C:\TripleSideWorker\backups\visual-verifier-before-20261021T094111Z`; task kembali running dengan tepat satu proses PID `5740`.
- Tidak ada job pelanggan yang di-retry atau dibuat. Build gagal tetap immutable; pengguna dapat memulai build Windows baru dari UI bila diinginkan.

## Perubahan terbaru — Export tidak lagi memakai artifact dari pipeline lama

- Laporan UI Export langsung 100% terkonfirmasi sebagai deduplikasi artifact lama, bukan build cepat: request `POST .../builds` mendapat 202 tetapi mengembalikan build ready `fd0e13a4-5a31-4aed-9a5a-2b1f84514324`; database tidak mendapat job baru.
- Akar masalah: deduplikasi ready artifact hanya membandingkan immutable project spec, platform, dan lisensi. Versi compiler/runtime/capture tidak ikut kunci, sehingga project yang tidak berubah dianggap identik setelah renderer diperbarui.
- Backend sekarang memakai `VST_BUILD_PIPELINE_REVISION=panel-child-visual-v1`. Revision masuk active dedupe key, disimpan pada job, ditampilkan di public job response, dan wajib sama ketika memakai ulang artifact ready.
- Build lama tidak memiliki revision tersebut, sehingga klik Export berikutnya tidak akan kembali ke artifact lama; server akan membuat job antrean nyata setelah dialog/biaya build dikonfirmasi.
- Tes build queue/worker/spec: `70 passed`.
- Hotfix backend live setelah audit active builds `0`; PM2 restart sukses, API lokal/publik `status: ok`, dan Nginx valid. Tidak ada job atau transaksi pelanggan yang dibuat oleh Codex.
- `backend/routers/vst_maker.py` dan test backend terkait memang baseline-nya untracked pada worktree production; hotfix ini live tetapi tidak dimasukkan ke commit `8876da4` agar tidak men-stage seluruh source backend untracked secara luas.

## Perubahan terbaru — child control dan label Mixer memakai visual Designer

- Akar build Neon Pop Rock Drums terlihat sama bukan cache: pipeline capture sengaja mengganti child control Panel Button dengan PNG transparan 1x1, lalu Windows menggambar fallback native dengan label hanya selebar sepertiga control; macOS belum menggambar child panel sama sekali.
- Capture build sekarang membuka parent panel yang benar dan meraster setiap child control langsung dari shared Designer preview, termasuk style, skin, label, posisi label, dan seluruh frame atlas.
- Background panel disembunyikan saat layer child diraster agar atlas transparan tidak membawa kontaminasi panel.
- Windows memetakan atlas child ke hit rectangle di dalam panel dan memakai visual hasil Designer; fallback label native juga diperbaiki menjadi full-width inset dengan alignment left/center/right.
- macOS sekarang menggambar atlas child panel yang sama serta mendukung drag, wheel, tombol/pad, dan double-click reset di dalam panel.
- Perubahan berada pada jalur capture/runtime bersama, jadi berlaku untuk semua template yang memakai child control di Panel Button, bukan hanya Neon Pop Rock Drums. Artifact lama tetap tidak berubah.
- Validasi integrasi terhadap endpoint production menghasilkan atlas child `161x171`, hit rect `112x122`, dan `101` frame; bukan lagi placeholder `1x1`.
- Commit: `8876da47ec33e9c614c8e3792262c7dee60de123` (`Render mixer panel controls from shared preview`).
- Frontend tests penuh: `180 passed`; native tests penuh: `118 passed`; optimized frontend build lulus.
- Smoke Windows installer run `39549897361`: sukses termasuk install/uninstall; artifact `12322464632`, digest `sha256:3f82ec2ec7595c89a0282c494f9af3d3e66c0814290d57b9b932f030f11fa517`.
- Smoke macOS Universal run `39549901942`: sukses arm64 + Intel; artifact `12323700091`, digest `sha256:d73c7cf369b9535af508088482fc132bee10d6c664c8d1fd8ce18ffede8618f7`.
- Worker Windows disinkronkan setelah audit active customer builds `0` dan jobs `0`; backup `C:\TripleSideWorker\backups\panel-child-capture-before-20261021T053543Z`; worker kembali satu proses PID `1628`.
- Build Windows Neon terakhir `fd0e13a4-5a31-4aed-9a5a-2b1f84514324` selesai sebelum fix ini dan tetap immutable. Build baru diperlukan untuk melihat hasil. Audit terakhir menunjukkan `correction_rebuilds_remaining: 0`; jangan membuat job atau mengubah kuota tanpa permintaan eksplisit pengguna.

## Perubahan terbaru — kontrol Mixer dan label native

- Layout channel Mixer Windows dan macOS disejajarkan lagi dengan preview: tinggi card dibatasi 159 px, padding horizontal 11 px, posisi label/track VOL dan PAN konsisten, serta tombol M/S memakai ukuran 42,5 × 22 px.
- Seluruh teks panel native sekarang memakai font Manrope yang dibundel. Nama sampler group tidak membungkus; nama panjang di Windows dipotong aman dengan ellipsis dan clipping seperti preview.
- Fader varian `mixer-metal` Windows/macOS sekarang mengikuti proporsi control Designer, dengan body, track, tick, LED, dan thumb yang diskalakan terhadap ukuran komponen.
- Double-click fader native sekarang mengembalikan nilai netral yang sesuai (termasuk volume, pan, output, mix, dan parameter module), setara dengan knob/preview.
- Commit: `95136e8fbf1de0006989a0750d4dbf8b41177070` (`Align native mixer controls with preview`) dan `de6b908942397dba07f1ce5779346c1e158074b7` (`Fix macOS fader neutral helper scope`).
- Native tests penuh: `117 passed`.
- Smoke Windows installer run `39545230627`: sukses termasuk build, install/uninstall, dan upload artifact `12321556823` (`sha256:3a3e712240241be5ce9c3b292130b3403d22ea50c3e0d0b0bdcd96db4ec490e3`).
- Smoke macOS Universal final run `39545587376`: sukses arm64 + Intel dan upload artifact `12321018453` (`sha256:a57ea7ea746bb2df0a106bcc94800698e45f691e2b15059cf354e2a11b9ee05f`). Run sebelumnya `39545233505` gagal karena scope helper C++ dan sudah diperbaiki oleh `de6b908`.
- Worker Windows disinkronkan setelah audit active customer builds `0` dan jobs `0`; tidak ada customer build yang dibuat atau diubah.
- Artefak customer lama tetap immutable. Neon Pop Rock Drums perlu menjalankan Rebuild Windows dan/atau Rebuild macOS baru untuk memperoleh tampilan Mixer ini; jangan enqueue otomatis.

## Perubahan terbaru — scrollbar Preset, parity Mixer, dan wheel fader

- Preset Browser native Windows/macOS sekarang memiliki scrollbar proporsional ketika jumlah preset melebihi kapasitas panel; mouse wheel/trackpad mengubah offset daftar.
- Row preset memiliki warna hover dan warna accent/border yang lebih kuat untuk preset aktif. Factory/user preset yang diklik tetap ditandai sebagai pilihan; preset baru otomatis dipilih dan discroll ke area terlihat.
- Skala Mixer Windows disamakan dengan CSS preview: header 12/8 px, nama channel 9 px, label VOL/PAN 7 px, tombol M/S 8 px, card 112 px dengan padding/gap preview, dan thumb slider accent 12 px. macOS memakai ukuran yang sama dan mendapat thumb slider yang setara.
- Wheel mouse kini dapat menaikkan/menurunkan Mixer VOL/PAN dan seluruh control native jenis `fader`, selain knob. Berlaku pada Windows dan macOS.
- Commit: `a886dee35fdceb212f62ceceee1a1478dabc0c05` (`Refine native preset and mixer panels`).
- Native tests penuh: `117 passed`.
- Smoke Windows installer run `39542090225`: sukses termasuk build, install/uninstall, dan upload artifact.
- Smoke macOS Universal run `39542090296`: sukses arm64 + Intel dan upload artifact.
- Worker Windows disinkronkan setelah audit active customer builds `0` dan jobs `0`; tidak ada customer build yang dibuat atau diubah.
- Existing artifact tetap immutable; perubahan baru tersedia setelah pengguna memilih Rebuild platform terkait.

## Perubahan terbaru — playback groove audio-thread dan parity Mixer/Preset

- Akar playback groove native yang tersendat saat panel ditutup atau parameter reverb/DSP diubah adalah transport MIDI lama berjalan dari timer UI. Ketika thread UI sibuk, pengiriman note ikut terlambat.
- Transport groove embedded sekarang dijadwalkan per-sample dari audio callback `NativeInstrument`; tempo map, Loop, Stop, pelepasan note, dan perubahan Loop diproses terpisah dari repaint/interaction UI.
- Timer UI Groove Browser Windows 10 ms dan timer MIDI macOS 10 ms dihapus. UI hanya polling status/repaint sekitar 30 fps, sehingga menutup panel atau menggerakkan parameter tidak lagi menentukan timing MIDI.
- Mixer Windows disusun ulang mengikuti preview: card channel horizontal, nama group, VOL/PAN, serta M/S. Renderer Mixer macOS yang sudah mengikuti struktur preview dipertahankan.
- Preset Browser Windows dan macOS sekarang mengikuti preview: input nama preset yang dapat diketik, tombol `Simpan kondisi`, row FACTORY/USER, load dan delete user preset; tombol `OVR` native yang tidak ada di preview dihilangkan.
- Normalisasi pan factory preset macOS diperbaiki agar memakai nilai manifest yang sudah `0..1`, sama seperti preview/Windows.
- Commit: `2e41da6e55ab915479d027d4078d7cc5a17b1a3c` (`Schedule native grooves on audio thread`).
- Native tests penuh: `116 passed`.
- Smoke Windows installer run `39538609272`: sukses termasuk build, install/uninstall, dan upload artifact.
- Smoke macOS Universal run `39538609021`: sukses arm64 + Intel dan upload artifact.
- Worker Windows disinkronkan setelah audit active customer builds `0` dan jobs `0`; tidak ada customer build yang dibuat atau diubah.
- Artefak customer lama tetap immutable. Pengguna perlu memilih `Rebuild Windows` dan/atau `Rebuild macOS` baru untuk memperoleh perubahan ini; jangan enqueue otomatis.

## Perubahan terbaru — penyederhanaan Groove Browser native

- Berlaku pada renderer Windows dan macOS di commit `4544dd4`.
- Header Groove Browser hanya menampilkan `GROOVE BROWSER` rata kiri; label tombol seperti `MIDI Groove 15` tidak lagi diduplikasi di header.
- Ikon close sekarang digambar sebagai dua stroke X seperti ikon preview, bukan glyph teks `×`.
- Area `Tambahkan groove MIDI`, jumlah pola, label `DRAG`, dan tombol hapus MIDI dihilangkan.
- Seluruh badan card MIDI (kecuali tombol Loop/Play) menjadi sumber drag ke DAW; cursor berubah menjadi pointing hand.
- Scrollbar dan wheel/trackpad scrolling ditambahkan saat jumlah groove melebihi tinggi panel.
- Import MIDI manual native ditutup pada UI, file picker, file drop Windows, dan file drop macOS. Groove hasil build hanya berasal dari project yang dibangun.
- Native tests penuh: `115 passed`.
- Smoke Windows installer run `39535943581`: sukses termasuk install/uninstall.
- Smoke macOS Universal run `39535946154`: sukses arm64 + Intel.
- Worker Windows disinkronkan setelah audit active builds `0` dan jobs `0`; tidak ada customer build yang dibuat atau diubah.

## Perubahan terbaru — parity Groove Browser Windows

- Akar masalah tampilan build Windows yang masih lama: perbaikan panel sebelumnya baru masuk renderer macOS, sedangkan worker Windows memakai salinan source terpisah yang belum diperbarui.
- Renderer Windows sekarang mengikuti preview web: header gelap beraksen, drop/import area MIDI, toolbar `GROOVE LIBRARY`, jumlah pattern, serta card groove dengan metadata, `DRAG`, `Loop`, `Play/Stop`, dan hapus.
- Klik area import membuka file picker `.mid/.midi`; drag MIDI keluar ke DAW dan state runtime hide/delete tetap dipertahankan.
- Commit: `9290d61c84c25bf978b5e3f32e1fc181de2e7de6` (`Match Windows groove panel to preview`).
- Native tests penuh: `115 passed`.
- Smoke Windows installer run `39456381197`: sukses, termasuk build installer, install/uninstall, dan upload artifact.
- Worker Windows sudah disinkronkan setelah audit active builds `0` dan jobs `0`; hash tiga file source cocok dengan VPS.
- Build Windows Neon Pop Rock Drums terakhir `e58426ab-0639-446b-9a09-3ab8231bcd4d` dibuat pada 2026-10-20 16:05 UTC sebelum sinkronisasi worker. Artefaknya immutable, sehingga panel barunya baru muncul setelah pengguna menjalankan `Rebuild Windows` baru. Jangan enqueue otomatis.

## Perubahan terbaru — parity panel fungsional macOS

- Renderer Cocoa macOS sekarang membuka, menutup, memindah, dan me-resize Panel Button mengikuti geometri preview web.
- Preset Browser, Mixer, dan Groove Browser memakai struktur, spacing, warna, header, card, serta tombol yang mengikuti preview sebagai patokan.
- Preset Browser dapat menyimpan, memuat, overwrite, dan menghapus user preset; snapshot control/group/module persisten di Application Support.
- Mixer dapat mengubah volume, pan, mute, dan solo setiap sampler group.
- Groove Browser dapat memilih, Play/Stop, Loop, menghapus groove dari sesi, import `.mid/.midi` lewat picker atau drop, dan drag file MIDI keluar ke DAW.
- Transport groove macOS memakai timer 10 ms dan tetap berjalan ketika panel ditutup.
- Commit rangkaian: `932cd1b`, `ae8016c`, `269d13c`.
- Native test penuh: `115 passed`.
- Smoke Universal macOS final run `39452007816`: sukses arm64 + Intel, termasuk packaging/upload artifact.
- Artefak customer yang sudah selesai sebelum commit ini tidak berubah; customer perlu menjalankan Rebuild macOS baru untuk memperoleh panel baru. Jangan enqueue otomatis.

## Perubahan terbaru — pilihan Rebuild per platform

- Tombol Rebuild Koreksi tunggal yang mengikuti latest-ready build dihapus agar platform tidak rancu.
- UI customer sekarang menampilkan `Rebuild Windows` dari chain Windows dan `Rebuild macOS` dari chain macOS secara terpisah.
- Setiap tombol mengirim `target_platform` eksplisit dan menampilkan sisa kesempatan platform masing-masing.
- Tes fokus frontend `18/18` lulus; optimized production build lulus dan aset live/lokal identik.

## Perubahan terbaru — Sustain pada preview Groove Browser

- Jalur `AudioBuffer` Groove Browser sekarang menghormati Sustain global project; note-off ditahan dan dilepas saat Sustain dimatikan.
- Parser web mempertahankan MIDI Sustain pedal CC64 (`control_change`) saat import baru.
- Transport web melacak CC64 per channel, menahan note-off selama pedal aktif, lalu melepasnya pada CC64 Off.
- Stop, akhir sequence, dan loop boundary selalu force-release agar tidak meninggalkan voice atau event terjadwal.
- Backend menerima dan menyimpan CC64 secara backward-compatible. Sequence lama tanpa CC64 tetap valid.
- Compiler native memfilter control-change dengan aman agar customer build tidak gagal atau menghasilkan ghost note. Native Groove Browser belum mengeksekusi CC64; perubahan ini khusus perilaku preview web.
- Sequence `Neon Pop Rock Drums 01` yang sudah tersimpan hanya memiliki note-on/off. Sustain global langsung bekerja; untuk membaca pedal yang tertanam di file, file MIDI perlu diimpor ulang lalu project disimpan.

## Perubahan terbaru — optimasi playback Groove Browser web

- Sampel yang dipakai groove dimuat dan didekode sekali ke cache `AudioBuffer` sebelum transport dimulai.
- Event MIDI memakai look-ahead 100 ms dengan pump 25 ms, lalu dijadwalkan terhadap waktu `AudioContext`; render React tidak lagi menentukan waktu bunyi pukulan.
- Semua voice sampler biasa berbagi satu graph Drive/Room, bukan membuat convolver/delay/chorus lengkap pada setiap note.
- Groove memakai `AudioBufferSourceNode` ringan per voice, dengan gain/pan per voice dan shared effects/DSP destination.
- One-shot tanpa loop/fade/custom range tidak lagi menjalankan `requestAnimationFrame` envelope per voice.
- Stop, akhir sequence, loop boundary, choke, fallback browser, dan cleanup event yang sudah dijadwalkan ditangani eksplisit.
- Perubahan hanya frontend; schema project, backend, database, native source, dan worker tidak berubah.
- Source frontend masih berada di worktree dirty/untracked yang disengaja dan belum di-commit/push; jangan staging luas.

## Perubahan terbaru — MIDI Groove Browser

Masalah yang diperbaiki:

- Playback browser tersendat karena satu `setTimeout` dibuat untuk setiap event MIDI.
- Belum ada pilihan Loop per groove.
- Menutup panel meng-unmount transport dan otomatis menghentikan MIDI.
- Native Windows mengeluarkan event hanya pada repaint UI 33 ms.

Implementasi sekarang:

- Transport browser dimiliki `InterfaceWorkspace`, bukan panel; menutup panel tidak menghentikan playback.
- Scheduler browser hanya menjadwalkan kelompok event berikutnya berdasarkan `performance.now()`, bukan seluruh event sekaligus.
- Stop/end selalu melepaskan note yang masih aktif.
- Setiap groove memiliki `loopEnabled`; backend menyimpan `loop_enabled`. Groove lama default Loop mati.
- Pilihan Loop ikut masuk manifest/build melalui `MidiSequenceInfo.loopEnabled`.
- Native Windows memisahkan groove terpilih dari groove yang sedang dimainkan, mempertahankan playback ketika panel ditutup, dan menyediakan tombol Loop.
- Native Windows memakai timer transport khusus 10 ms; repaint tetap 33 ms.
- MIDI import native bersifat runtime. Override Loop untuk file yang di-drop di native berlaku selama instance plugin hidup; default Loop yang tertanam dari project tetap persisten.

Catatan batasan:

- Timer Windows 10 ms jauh lebih halus daripada 33 ms, tetapi belum sample-accurate terhadap audio callback DAW.
- `NativeViewMac.mm` sekarang memiliki Groove Browser interaktif, panel Preset, dan Mixer. Jalur sustain CC64 embedded native masih tetap difilter oleh compiler; transport native saat ini menjalankan note on/off dan loop.
- Audit terbaru project produksi **Neon Pop Rock Drums** (`092b3d46-6e53-44bf-b5c8-2ecfb272bce2`) menemukan satu sequence tersimpan, `Neon Pop Rock Drums 01` (128 event, Loop aktif). File yang diimpor di browser menjadi data project persisten setelah project disimpan.

File utama:

- `frontend/src/pages/VstMakerPreview.jsx`
- `frontend/src/lib/vstMidiFile.js`
- `frontend/src/lib/vstMidiFile.test.js`
- `frontend/src/lib/vstMidiScheduler.js`
- `frontend/src/lib/vstMidiScheduler.test.js`
- `frontend/src/pages/VstMakerPreview.css`
- `backend/routers/vst_maker.py`
- `native-vst3/tools/compile_manifest.py`
- `native-vst3/Source/NativeView.h`
- `native-vst3/Source/NativeView.cpp`

## Verifikasi terbaru

- Frontend: `180/180` lulus.
- Backend fokus schema/template/build: `108/108` lulus.
- Native penuh: `114/114` lulus.
- Optimized frontend production build: lulus.
- `git diff --check` untuk perubahan terkait: bersih.
- Suite backend VST yang lebih luas: `176 passed`, `3 failed`. Ketiga kegagalan sudah ada pada mock lifecycle penghapusan storage/template dan tidak berkaitan dengan Groove Browser atau schema MIDI.

Smoke lintas platform pada commit `cb8116c`:

- macOS Universal run `39438426072`: sukses dalam 2m50s.
  - Artifact `12271723661`, `tripleside-macos-vst3-universal`
  - Digest `sha256:58bc6c304c830bcaabaffbf8d3041f831998c13736cdc13a7162b300b369fd43`
- Windows installer run `39438431268`: sukses dalam 3m31s, termasuk install/uninstall.
  - Artifact `12273118802`, `tripleside-windows-vst3-installer`
  - Digest `sha256:b7f7e015164642609e1e0be4c3e5eb52b87d360f9b18cf61507fa4d7e7ae11e4`

## Worker

### Windows

- Host: `103.59.94.137`, user `Administrator`.
- SSH key: `/home/triplesidestudio/.codex/vst-worker-setup-ed25519`.
- Source worker: `C:\TripleSideWorker\native-vst3`.
- Scheduled Task: `TripleSide VST Build Worker`.
- Script: `C:\TripleSideWorker\run-windows-vst-worker.ps1`.
- Status audit terakhir: task running, tepat 1 worker process (PID terakhir `3628`), jobs `0`; active customer builds `0`.
- Backup terbaru: `C:\TripleSideWorker\backups\keyboard-atlas-toggle-before-20261022T023830Z`.
- Hash worker/VPS cocok:
  - `NativeInstrument.cpp`: `421cd7a029aade2d383301a04c885dd8b5380a0f45ba5b4c1b0c2a96a2538790`
  - `NativeInstrument.h`: `afdb1f98f456ff29cb65b66308a507478ffc95215247e96b21b12114357f04d3`
  - `CMakeLists.txt`: `259a3190c1e09acb63eceb562df9583d14d02e7c8defd0b93d9d27af0e895a74`
  - `NativeView.cpp`: `eb3b7c4160971c354953f44662d040406df4100fee3e3e64bcbc66ce4e9b6744`
  - `NativeView.h`: `d53d4fa321db1b3a5808fb570b05e7d3a45310a8c9da415ced0a4b386ec25249`
  - `compile_manifest.py`: `6ff956a883b601092635eb942f2fd0f4a72c2e7b0abd94f9535755885872473c`
  - `render_visual_assets.py`: `86b02bd91b372c73f051f98645c9a53cb2ed2d8f1503191c657e77bdfd9dda28`
  - `verify_visual_assets.py`: `48947757deda54739cce46175315830cb2a0f36f66565aa6b754e1f1333ca6e4`
  - `Manrope-wght.ttf`: `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6`
- Audit terakhir menemukan dua proses worker akibat satu proses legacy. Proses ekstra dihentikan; jangan mengasumsikan jumlah proses sehat tanpa memeriksa command line sebenarnya.

### macOS

- Worker customer menggunakan GitHub Actions dan checkout `main`.
- Workflow smoke: `Native VST3 macOS smoke build`.
- Dispatcher timer VPS: `tripleside-macos-worker-dispatch.timer`, enabled/active.
- Dispatcher hanya boleh menjalankan workflow ketika ada job macOS yang memang claimable; jangan membuat job pelanggan untuk mengetes worker.

## Fitur penting yang sudah deployed

- Rotasi `−180°…180°` untuk setiap komponen Designer, persisten dan kompatibel dengan browser, hit-testing, capture atlas, Windows, dan macOS.
- Neon Pop Rock Drums: level native disejajarkan dengan preview, hit pad memakai flash transient 115 ms, dan rapid same-position double-click tetap retrigger.
- Global Tuning & Fine Tune untuk sampler dan Wave Generator.
- Prism EQ lima band dengan mode contextual/direct, shared Frequency/Gain/Q, node editing, pure spectrum, dan vectorscope.
- DSP Rack v2, Parametric EQ, Multiband Compressor, De-esser, True Reverb, delay/modulation, amp/cabinet IR, tuning, dan Wave Generator polyphonic.
- Preset browser, mixer, Panel Button, MIDI Groove Browser, drag MIDI ke DAW pada native Windows, Mapping/choke/tempo sync/loop/sustain, serta meter mono/stereo dan gain reduction.
- Export/build Windows dan macOS terpisah, installer/uninstaller, build licensing, personal/resale licenses, correction rebuild, pricing credits, dan latest-ready download per platform.
- Shared browser/native visual capture memakai Playwright browser bersama pada worker Windows (`C:\TripleSideWorker\ms-playwright`).

## Arsitektur singkat

- Frontend: React/CRACO di `frontend/`; Nginx langsung melayani `frontend/build`.
- Backend: FastAPI di `backend/`, dijalankan PM2 sebagai `triplesidestudio-backend`, port lokal `8000`.
- Database: MongoDB lokal; koleksi build `vst_maker_build_jobs`.
- Native: `native-vst3/`; manifest dibentuk oleh `native-vst3/tools/compile_manifest.py`.
- Windows worker memakai salinan source terpisah, bukan otomatis membaca source VPS.
- macOS hosted worker membaca commit `main` dari GitHub.
- Telegram notifier: `/home/triplesidestudio/tripleside-ai-agent/ai/telegram/telegram_notifier.py`; jalankan dengan virtualenv project agent, bukan Python sistem.

## Aturan keselamatan wajib

- Worktree sengaja sangat dirty dan banyak source frontend/backend masih untracked. Jangan `git reset --hard`, `git clean`, checkout/restore massal, atau staging luas.
- Stage/commit hanya file yang benar-benar ditinjau dan termasuk tugas.
- Jangan pernah mencetak token worker, token Telegram, kredensial database, atau secret GitHub.
- Sebelum sinkronisasi worker:
  1. Pastikan database active builds `0`.
  2. Pastikan folder jobs worker kosong.
  3. Hentikan task/proses worker selama overlay.
  4. Buat backup bertanggal.
  5. Overlay hanya file terkait dan cocokkan SHA-256.
  6. Hidupkan task dan pastikan tepat satu proses aktual.
- Jangan enqueue, retry, cancel, claim, atau mengubah job pelanggan tanpa permintaan eksplisit pengguna.
- Smoke build internal GitHub boleh digunakan untuk membuktikan kompilasi; jangan menyamakannya dengan customer build.
- Existing artifacts/build pelanggan bersifat immutable; jangan dihapus atau ditimpa.
- Setelah deployment: cek PM2, API lokal/publik, hash aset live, Nginx, worker, dan active jobs.

## Perintah verifikasi umum

```bash
# Frontend
cd /home/triplesidestudio/tripleside/frontend
npm test -- --runInBand
npm run build

# Backend fokus VST
cd /home/triplesidestudio/tripleside
PYTHONPATH=backend backend/venv/bin/pytest -q \
  backend/tests/test_vst_maker_templates.py \
  backend/tests/test_vst_maker_build_spec.py

# Native
cd /home/triplesidestudio/tripleside/native-vst3
../backend/venv/bin/pytest -q tests

# Health
pm2 show triplesidestudio-backend --no-color
curl -fsS http://127.0.0.1:8000/api/
curl -fsS https://triplesidestudio.com/api/
sudo -n nginx -t
```

## Saat melanjutkan

1. Baca dokumen ini dan `git status` tanpa mengubah worktree.
2. Anggap state paling atas sebagai baseline production.
3. Periksa apakah permintaan hanya diagnosis atau mengizinkan implementasi/deployment.
4. Pertahankan kompatibilitas project lama dengan nilai default.
5. Uji sesuai risiko, sinkronkan worker hanya bila native/compiler berubah, lalu perbarui bagian atas handoff.
