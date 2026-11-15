Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef PROJECT_ROOT
  !define PROJECT_ROOT ".."
!endif

; Definición general del instalador de la Terminal de Venta (Caja Secundaria)
Name "Isaac POS - Terminal de Ventas (Caja Secundaria)"
OutFile "${PROJECT_ROOT}\dist_installers\2_IsaacPOS_Caja_Terminal_Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Isaac POS Ultra"
InstallDirRegKey HKCU "Software\IsaacPOSTerminal" "InstallDir"
RequestExecutionLevel admin

; Compresión Ultra sólida LZMA para máxima reducción de tamaño
SetCompressor /SOLID lzma

; Iconos del instalador
!define MUI_ICON "${PROJECT_ROOT}\american-pos-backend\public\favicon.ico"
!define MUI_UNICON "${PROJECT_ROOT}\american-pos-backend\public\favicon.ico"
!define MUI_ABORTWARNING

; Personalización gráfica moderna
!define MUI_WELCOMEFINISHPAGE_BITMAP "${PROJECT_ROOT}\build_ultra\assets\wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${PROJECT_ROOT}\build_ultra\assets\wizard.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${PROJECT_ROOT}\build_ultra\assets\header.bmp"
!define MUI_HEADERIMAGE_RIGHT

; Marca en pie de página del instalador
BrandingText "Isaac POS • Terminal de Ventas (Caja Secundaria)"

; Páginas del instalador
!define MUI_WELCOMEPAGE_TITLE "Isaac POS - Terminal de Ventas"
!define MUI_WELCOMEPAGE_TEXT "Este instalador configurará este equipo como una CAJA SECUNDARIA de su negocio.$\r$\n$\r$\n• Instalación ultra compacta (~57 MB)$\r$\n• No requiere instalar motor de base de datos en esta PC$\r$\n• Auto-detección inteligente del Servidor Principal en la red local$\r$\n• Modo Offline-First para cobro ininterrumpido$\r$\n$\r$\nHaga clic en 'Siguiente' para continuar."
!insertmacro MUI_PAGE_WELCOME

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Terminal de Ventas Instalada"
!define MUI_FINISHPAGE_TEXT "La terminal de Isaac POS ha sido instalada con éxito.$\r$\n$\r$\nAl iniciar, la terminal se conectará automáticamente con el Servidor Principal en su red local."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Isaac POS.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Iniciar Terminal de Ventas ahora"
!insertmacro MUI_PAGE_FINISH

; Páginas de desinstalación
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Idioma español
!insertmacro MUI_LANGUAGE "Spanish"

Section "Isaac POS Terminal de Ventas" SecMain
    DetailPrint "Cerrando instancias previas de Isaac POS..."
    nsExec::Exec 'cmd.exe /c taskkill /F /IM "Isaac POS.exe" /T'
    nsExec::Exec 'cmd.exe /c taskkill /F /IM "node.exe" /T'
    nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3005,5005,8080 -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $$_.OwningProcess -Force } catch {} }"'
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
    File /r /x ".env" /x ".env.*" /x "settings.json" /x "db-config.json" /x "*.pfx" /x "*private*.pem" "${PROJECT_ROOT}\build_ultra\app_files\*.*"

    ; Crear desinstalador
    WriteUninstaller "$INSTDIR\Uninstall_Terminal.exe"

    ; Configurar modo Terminal / Cliente en db-config.json de forma nativa
    DetailPrint "Estableciendo configuracion de modo Terminal de Ventas..."
    CreateDirectory "$APPDATA\isaac-pos"
    FileOpen $0 "$APPDATA\isaac-pos\db-config.json" w
    FileWrite $0 '{"mode":"client","dialect":"postgres","host":"","port":5432,"database":"americanpos","user":"postgres","password":"postgres"}'
    FileClose $0

    ; Accesos directos en Menú Inicio y Escritorio
    CreateDirectory "$SMPROGRAMS\Isaac POS"
    CreateShortcut "$SMPROGRAMS\Isaac POS\Isaac POS (Caja Terminal).lnk" "$INSTDIR\Isaac POS.exe" "" "$INSTDIR\Isaac POS.exe" 0
    CreateShortcut "$SMPROGRAMS\Isaac POS\Desinstalar Terminal.lnk" "$INSTDIR\Uninstall_Terminal.exe" "" "$INSTDIR\Uninstall_Terminal.exe" 0
    CreateShortcut "$DESKTOP\Isaac POS - Caja Terminal.lnk" "$INSTDIR\Isaac POS.exe" "" "$INSTDIR\Isaac POS.exe" 0

    ; Configurar Inicio Automático con Windows vía Registro Run
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS Terminal" '"$INSTDIR\Isaac POS.exe"'

    ; Configurar Firewall de Windows para admitir el socket P2P y backend local
    DetailPrint "Configurando Firewall de Windows..."
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    nsExec::Exec 'netsh advfirewall firewall add rule name="Isaac POS Backend" dir=in action=allow protocol=TCP localport=3005 profile=private,public'

    ; Registro de Windows
    WriteRegStr HKCU "Software\IsaacPOSTerminal" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSTerminal" "DisplayName" "Isaac POS (Terminal de Ventas - Caja)"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSTerminal" "UninstallString" '"$INSTDIR\Uninstall_Terminal.exe"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSTerminal" "DisplayIcon" "$INSTDIR\Isaac POS.exe,0"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSTerminal" "Publisher" "Isaac POS Team"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSTerminal" "DisplayVersion" "24.04.0"
SectionEnd

Section "Uninstall"
    DetailPrint "Cerrando instancias de Isaac POS antes de desinstalar..."
    nsExec::Exec 'cmd.exe /c taskkill /F /IM "Isaac POS.exe" /T'
    Sleep 1000

    ; Eliminar directorio de instalación
    RMDir /r "$INSTDIR"

    ; Eliminar accesos directos
    Delete "$DESKTOP\Isaac POS - Caja Terminal.lnk"
    RMDir /r "$SMPROGRAMS\Isaac POS"

    ; Limpiar Firewall y registros
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS Terminal"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSTerminal"
    DeleteRegKey HKCU "Software\IsaacPOSTerminal"
SectionEnd
