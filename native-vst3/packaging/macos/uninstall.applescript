on run argv
    if (count of argv) is not 3 then
        display alert "Uninstaller tidak valid" message "Informasi produk tidak lengkap." as critical
        return
    end if

    set pluginPath to item 1 of argv
    set packageId to item 2 of argv
    set productName to item 3 of argv
    set vstRoot to "/Library/Audio/Plug-Ins/VST3/"

    if pluginPath does not start with vstRoot or pluginPath does not end with ".vst3" then
        display alert "Uninstaller dibatalkan" message "Lokasi plugin tidak aman." as critical
        return
    end if
    if packageId does not start with "com.triplesidestudio.vst3." then
        display alert "Uninstaller dibatalkan" message "Identitas paket tidak dikenal." as critical
        return
    end if

    set answer to display dialog "Hapus " & productName & " dari folder VST3 sistem? Preset dan project DAW Anda tidak akan dihapus." buttons {"Batal", "Uninstall"} default button "Uninstall" cancel button "Batal" with icon caution
    if button returned of answer is not "Uninstall" then return

    set commandText to "if [ -e " & quoted form of pluginPath & " ]; then /bin/rm -rf -- " & quoted form of pluginPath & " || exit 1; fi; /usr/sbin/pkgutil --forget " & quoted form of packageId & " >/dev/null 2>&1 || true"
    try
        do shell script commandText with administrator privileges
        display dialog productName & " berhasil dihapus." buttons {"OK"} default button "OK" with icon note
    on error errorMessage
        display alert "Uninstall gagal" message errorMessage as critical
    end try
end run
