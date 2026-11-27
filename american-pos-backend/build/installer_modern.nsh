; ==============================================================================
; Isaac POS - Custom NSIS Configuration (Edición Moderna Windows 10 / 11)
; Motor: Electron 45.4.1 (Chromium 156 + Node.js 24.22)
; Base de Datos Predeterminada: PostgreSQL 16
; ==============================================================================
!include "LogicLib.nsh"

!macro customInit
  ; Preguntar al usuario el rol de este equipo en Windows 10/11
  MessageBox MB_YESNO|MB_ICONQUESTION "Instalador de Isaac POS Modern (Windows 10 / 11)$\r$\n$\r$\nSeleccione el modo de operación para este equipo:$\r$\n$\r$\n• [SÍ] SERVIDOR PRINCIPAL (Base de Datos PostgreSQL 16):$\r$\n  Recomendado para la computadora principal de su negocio. Configura el motor PostgreSQL 16 local y habilita el servidor de red para otras cajas y móviles.$\r$\n$\r$\n• [NO] CAJA TERMINAL (Cliente en Red Local):$\r$\n  Para conectar esta terminal a un Servidor Principal en su red local sin requerir base de datos local.$\r$\n$\r$\n¿Desea configurar esta computadora como SERVIDOR PRINCIPAL con PostgreSQL?" IDNO config_client

  ; Opción 1: Servidor Principal (PostgreSQL 16 Local)
  CreateDirectory "$APPDATA\isaac-pos"
  ; Nota: instalar_postgresql.ps1 inicializa db-config.json solo si no existe, usando la contraseña aleatoria fuerte generada
  Goto config_done

  config_client:
  ; Opción 2: Caja Terminal (Cliente LAN)
  CreateDirectory "$APPDATA\isaac-pos"
  IfFileExists "$APPDATA\isaac-pos\db-config.json" config_done 0
  FileOpen $0 "$APPDATA\isaac-pos\db-config.json" w
  FileWrite $0 '{"mode":"client","dialect":"postgres","host":"","port":5432,"database":"americanpos","user":"postgres","password":""}'
  FileClose $0

  config_done:
!macroend

!macro customInstall
  DetailPrint "Verificando configuracion de base de datos PostgreSQL..."
  
  IfFileExists "$APPDATA\isaac-pos\db-config.json" check_existing_mode run_server_setup
  check_existing_mode:
    ; Comprobar si el modo seleccionado fue "server"
    nsExec::Exec 'powershell.exe -NoProfile -Command "if ((Get-Content -Raw \"$APPDATA\isaac-pos\db-config.json\" -ErrorAction SilentlyContinue | ConvertFrom-Json).mode -eq ''server'') { exit 0 } else { exit 1 }"'
    Pop $0
    StrCmp $0 "0" run_server_setup install_terminal_firewall

  run_server_setup:
    DetailPrint "Configurando e instalando motor PostgreSQL 16..."
    
    ; Localizar y ejecutar instalar_postgresql.ps1
    ${if} ${FileExists} "$INSTDIR\resources\scripts\instalar_postgresql.ps1"
      nsExec::Exec 'powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\scripts\instalar_postgresql.ps1"'
    ${elseIf} ${FileExists} "$INSTDIR\resources\app.asar.unpacked\scripts\instalar_postgresql.ps1"
      nsExec::Exec 'powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\scripts\instalar_postgresql.ps1"'
    ${elseIf} ${FileExists} "$INSTDIR\scripts\instalar_postgresql.ps1"
      nsExec::Exec 'powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\instalar_postgresql.ps1"'
    ${endIf}

    ; Reglas de Firewall para Servidor Principal restringidas a subred local privada (Puertos 3005 y 5432)
    DetailPrint "Configurando Firewall de Windows para red privada local (puertos 3005 y 5432)..."
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    nsExec::Exec 'netsh advfirewall firewall add rule name="Isaac POS Backend" dir=in action=allow protocol=TCP localport=3005 remoteip=localsubnet profile=private'
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS PostgreSQL"'
    nsExec::Exec 'netsh advfirewall firewall add rule name="Isaac POS PostgreSQL" dir=in action=allow protocol=TCP localport=5432 remoteip=localsubnet profile=private'
    Goto install_done

  install_terminal_firewall:
    ; Reglas de Firewall para Terminal de Ventas restringidas a red privada local (Puerto 3005)
    DetailPrint "Configurando Firewall de Windows para Terminal en red privada (puerto 3005)..."
    nsExec::Exec 'netsh advfirewall firewall delete rule name="Isaac POS Backend"'
    nsExec::Exec 'netsh advfirewall firewall add rule name="Isaac POS Backend" dir=in action=allow protocol=TCP localport=3005 remoteip=localsubnet profile=private'

  install_done:
!macroend
