Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef PROJECT_ROOT
  !define PROJECT_ROOT ".."
!endif

; Definición general del instalador
Name "Isaac POS V24.04 Ultra (Windows 10/11)"
OutFile "${PROJECT_ROOT}\dist_installers\Isaac-POS-Ultra-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Isaac POS Ultra"
InstallDirRegKey HKCU "Software\IsaacPOSUltra" "InstallDir"
RequestExecutionLevel admin

; Compresión Ultra sólida LZMA para máxima reducción de tamaño
SetCompressor /SOLID lzma

; Iconos del instalador
!define MUI_ICON "${PROJECT_ROOT}\american-pos-backend\public\favicon.ico"
!define MUI_UNICON "${PROJECT_ROOT}\american-pos-backend\public\favicon.ico"
!define MUI_ABORTWARNING

; Personalización gráfica moderna (Logo y Banners personalizados)
!define MUI_WELCOMEFINISHPAGE_BITMAP "${PROJECT_ROOT}\build_ultra\assets\wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${PROJECT_ROOT}\build_ultra\assets\wizard.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${PROJECT_ROOT}\build_ultra\assets\header.bmp"
!define MUI_HEADERIMAGE_RIGHT

; Marca en pie de página del instalador
BrandingText "Isaac POS • Tecnología Ultra Windows 10/11"

; Páginas del instalador
!define MUI_WELCOMEPAGE_TITLE "Bienvenido a Isaac POS Ultra"
!define MUI_WELCOMEPAGE_TEXT "Esta versión cuenta con el motor nativo de escritorio de alta velocidad.$\r$\n$\r$\n• Motor nativo Electron aislado de alto rendimiento$\r$\n• Impresión térmica silenciosa y control de periféricos$\r$\n• Interfaz moderna Glassmorphism optimizada para ventas$\r$\n$\r$\nHaga clic en 'Siguiente' para continuar."
!insertmacro MUI_PAGE_WELCOME

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Instalación Completada"
!define MUI_FINISHPAGE_TEXT "Isaac POS Ultra ha sido instalado con éxito en su equipo.$\r$\n$\r$\nDisfrute de la máxima velocidad, interfaz moderna y menor consumo de memoria del sistema."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Isaac POS.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Ejecutar Isaac POS Ultra ahora"
!insertmacro MUI_PAGE_FINISH

; Páginas de desinstalación
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Idioma español
!insertmacro MUI_LANGUAGE "Spanish"

Section "Isaac POS Ultra" SecMain
    DetailPrint "Cerrando instancias previas de Isaac POS..."
    nsExec::Exec 'cmd.exe /c taskkill /F /IM "Isaac POS.exe" /T'
    nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3005,5005,8080 -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $$_.OwningProcess -Force } catch {} }"'
    nsExec::Exec 'powershell.exe -NoProfile -Command "Get-Process | Where-Object { $$_.Path -like ''*Isaac POS Ultra*'' } | ForEach-Object { try { [System.Diagnostics.Process]::GetProcessById($$_.Id).Kill() } catch {} }"'
    Sleep 1500

    DetailPrint "Limpiando residuos de versiones anteriores..."
    Delete "$INSTDIR\*.apk"
    Delete "$INSTDIR\test_*.js"
    Delete "$INSTDIR\check_*.js"
    Delete "$INSTDIR\fix_*.js"
    Delete "$INSTDIR\inspect_*.js"
    Delete "$INSTDIR\find_*.js"
    Delete "$INSTDIR\backup_debug.log"
    Delete "$INSTDIR\tailwind.config.js"
    Delete "$INSTDIR\Instalar Isaac POS.bat"
    RMDir /r "$INSTDIR\edge_data"
    RMDir /r "$INSTDIR\pos_browser_data"

    SetOverwrite on
    SetOutPath "$INSTDIR"
    File /r /x ".env" /x ".env.*" /x "settings.json" /x "db-config.json" /x "cloud_mirror_config.json" /x ".dbcfg.key.dpapi" /x ".secrets.key.dpapi" /x "secrets.vault.json" /x "*.vault.json" /x "*.pfx" /x "*.key" /x "*private*.pem" "${PROJECT_ROOT}\build_ultra\app_files\*.*"

    ; Crear desinstalador
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; Accesos directos en Menú Inicio y Escritorio
    CreateDirectory "$SMPROGRAMS\Isaac POS Ultra"
    CreateShortcut "$SMPROGRAMS\Isaac POS Ultra\Isaac POS Ultra.lnk" "$INSTDIR\Isaac POS.exe" "" "$INSTDIR\Isaac POS.exe" 0
    CreateShortcut "$SMPROGRAMS\Isaac POS Ultra\Desinstalar Isaac POS Ultra.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
    CreateShortcut "$DESKTOP\Isaac POS Ultra.lnk" "$INSTDIR\Isaac POS.exe" "" "$INSTDIR\Isaac POS.exe" 0

    ; Limpiar accesos directos en la carpeta de Inicio de Windows (Startup) para evitar doble apertura
    Delete "$SMSTARTUP\Isaac POS.lnk"
    Delete "$SMSTARTUP\Isaac POS Ultra.lnk"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS"

    ; Configurar Inicio Automático con Windows únicamente vía Registro Run
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS Ultra" '"$INSTDIR\Isaac POS.exe"'

    ; Configurar regla en el Firewall de Windows restringida a red privada local (puerto 3005)
    DetailPrint "Configurando Firewall de Windows para red privada local (puerto 3005)..."
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    nsExec::Exec 'netsh advfirewall firewall add rule name="Isaac POS Backend" dir=in action=allow protocol=TCP localport=3005 remoteip=localsubnet profile=private'

    ; Registro de Windows para Panel de Control / Configuración de Aplicaciones
    WriteRegStr HKCU "Software\IsaacPOSUltra" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSUltra" "DisplayName" "Isaac POS V24.04 (Edición Ultra Windows 10/11)"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSUltra" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSUltra" "DisplayIcon" "$INSTDIR\Isaac POS.exe,0"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSUltra" "Publisher" "Isaac POS Team"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSUltra" "DisplayVersion" "24.04.0"
SectionEnd

Section "Uninstall"
    DetailPrint "Cerrando instancias de Isaac POS antes de desinstalar..."
    nsExec::Exec 'cmd.exe /c taskkill /F /IM "Isaac POS.exe" /T'
    nsExec::Exec 'powershell.exe -NoProfile -Command "Get-Process | Where-Object { $$_.Path -like ''*Isaac POS Ultra*'' } | ForEach-Object { try { [System.Diagnostics.Process]::GetProcessById($$_.Id).Kill() } catch {} }"'
    Sleep 1000

    ; Eliminar directorio de instalación
    RMDir /r "$INSTDIR"

    ; Eliminar accesos directos
    Delete "$DESKTOP\Isaac POS Ultra.lnk"
    Delete "$SMSTARTUP\Isaac POS Ultra.lnk"
    Delete "$SMSTARTUP\Isaac POS.lnk"
    RMDir /r "$SMPROGRAMS\Isaac POS Ultra"

    ; Limpiar registros y reglas de Firewall
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS Ultra"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSUltra"
    DeleteRegKey HKCU "Software\IsaacPOSUltra"
SectionEnd
