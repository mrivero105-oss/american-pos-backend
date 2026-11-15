Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef PROJECT_ROOT
  !define PROJECT_ROOT ".."
!endif

; Definición general del instalador del Servidor Principal
Name "Isaac POS - Servidor Principal (Servidor + Base de Datos)"
OutFile "${PROJECT_ROOT}\dist_installers\1_IsaacPOS_Servidor_Principal_Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Isaac POS Ultra"
InstallDirRegKey HKCU "Software\IsaacPOSServer" "InstallDir"
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
BrandingText "Isaac POS • Servidor Principal de Base de Datos"

; Páginas del instalador
!define MUI_WELCOMEPAGE_TITLE "Isaac POS - Servidor Principal"
!define MUI_WELCOMEPAGE_TEXT "Este instalador configurará este equipo como el SERVIDOR PRINCIPAL de su negocio.$\r$\n$\r$\n• Aplicación central Isaac POS$\r$\n• Instalación automatizada del motor PostgreSQL 16$\r$\n• Creación de la base de datos central limpia y segura$\r$\n• Habilitación de puertos de red para cajas secundarias$\r$\n$\r$\nHaga clic en 'Siguiente' para comenzar la instalación."
!insertmacro MUI_PAGE_WELCOME

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Servidor Principal Instalado"
!define MUI_FINISHPAGE_TEXT "Isaac POS y el motor de Base de Datos PostgreSQL han sido configurados exitosamente en este Servidor.$\r$\n$\r$\nLas cajas secundarias ahora podrán conectarse a este equipo en la red local."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Isaac POS.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Iniciar Isaac POS (Servidor Principal)"
!insertmacro MUI_PAGE_FINISH

; Páginas de desinstalación
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Idioma español
!insertmacro MUI_LANGUAGE "Spanish"

Section "Isaac POS Servidor Principal" SecMain
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
    WriteUninstaller "$INSTDIR\Uninstall_Server.exe"

    ; Configurar modo Servidor en db-config.json de forma nativa (main.js migrará a DPAPI en el 1er arranque)
    DetailPrint "Estableciendo configuracion de modo Servidor Principal..."
    CreateDirectory "$APPDATA\isaac-pos"
    FileOpen $0 "$APPDATA\isaac-pos\db-config.json" w
    FileWrite $0 '{"mode":"server","dialect":"postgres","host":"127.0.0.1","port":5432,"database":"americanpos","user":"postgres","password":"postgres"}'
    FileClose $0

    ; Instalar y Configurar PostgreSQL 16
    DetailPrint "Configurando motor de base de datos PostgreSQL 16..."
    nsExec::Exec 'powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\instalar_postgresql.ps1"'

    ; Accesos directos en Menú Inicio y Escritorio
    CreateDirectory "$SMPROGRAMS\Isaac POS"
    CreateShortcut "$SMPROGRAMS\Isaac POS\Isaac POS (Servidor Principal).lnk" "$INSTDIR\Isaac POS.exe" "" "$INSTDIR\Isaac POS.exe" 0
    CreateShortcut "$SMPROGRAMS\Isaac POS\Desinstalar Servidor.lnk" "$INSTDIR\Uninstall_Server.exe" "" "$INSTDIR\Uninstall_Server.exe" 0
    CreateShortcut "$DESKTOP\Isaac POS - Servidor Principal.lnk" "$INSTDIR\Isaac POS.exe" "" "$INSTDIR\Isaac POS.exe" 0

    ; Configurar Inicio Automático con Windows vía Registro Run
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS Server" '"$INSTDIR\Isaac POS.exe"'

    ; Configurar reglas de Firewall de Windows para admitir conexiones entrantes
    DetailPrint "Configurando Firewall de Windows para red local (puertos 3005 y 5432)..."
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    nsExec::Exec 'netsh advfirewall firewall add rule name="Isaac POS Backend" dir=in action=allow protocol=TCP localport=3005 profile=private,public'
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS PostgreSQL"'
    nsExec::Exec 'netsh advfirewall firewall add rule name="Isaac POS PostgreSQL" dir=in action=allow protocol=TCP localport=5432 remoteip=localsubnet profile=private,public'

    ; Registro de Windows
    WriteRegStr HKCU "Software\IsaacPOSServer" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSServer" "DisplayName" "Isaac POS (Servidor Principal + Base de Datos)"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSServer" "UninstallString" '"$INSTDIR\Uninstall_Server.exe"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSServer" "DisplayIcon" "$INSTDIR\Isaac POS.exe,0"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSServer" "Publisher" "Isaac POS Team"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSServer" "DisplayVersion" "24.04.0"
SectionEnd

Section "Uninstall"
    DetailPrint "Cerrando instancias de Isaac POS antes de desinstalar..."
    nsExec::Exec 'cmd.exe /c taskkill /F /IM "Isaac POS.exe" /T'
    Sleep 1000

    ; Eliminar directorio de instalación
    RMDir /r "$INSTDIR"

    ; Eliminar accesos directos
    Delete "$DESKTOP\Isaac POS - Servidor Principal.lnk"
    RMDir /r "$SMPROGRAMS\Isaac POS"

    ; Limpiar reglas de Firewall y registros
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS PostgreSQL"'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Isaac POS Server"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSServer"
    DeleteRegKey HKCU "Software\IsaacPOSServer"
SectionEnd
