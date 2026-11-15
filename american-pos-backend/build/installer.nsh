; ==============================================================================
; Isaac POS - Custom NSIS Configuration (Edición Especial Windows 7 / 8 / 8.1)
; ==============================================================================

!macro customInit
  ; Preguntar al usuario el rol de este equipo
  MessageBox MB_YESNO|MB_ICONQUESTION "Instalador de Isaac POS (Edición Windows 7 / 8 / 8.1)$\r$\n$\r$\nSeleccione el modo de operación para este equipo:$\r$\n$\r$\n• [SÍ] SERVIDOR LOCAL (PostgreSQL en esta PC):$\r$\n  Conecta esta PC a un motor PostgreSQL instalado localmente en 127.0.0.1:5432.$\r$\n$\r$\n• [NO] CAJA TERMINAL (Cliente en Red Local):$\r$\n  Recomendado para Windows 7/8/8.1: conecta esta caja a un Servidor Principal Windows 10/11 en su red local sin instalar base de datos aquí.$\r$\n$\r$\n¿Desea configurar esta computadora como SERVIDOR LOCAL (127.0.0.1)?" IDNO config_client

  ; Opción 1: Servidor Local (PostgreSQL en 127.0.0.1)
  CreateDirectory "$APPDATA\isaac-pos"
  FileOpen $0 "$APPDATA\isaac-pos\db-config.json" w
  FileWrite $0 '{"mode":"server","dialect":"postgres","host":"127.0.0.1","port":5432,"database":"americanpos","user":"postgres","password":"postgres"}'
  FileClose $0
  Goto config_done

  config_client:
  ; Opción 2: Caja Terminal (Cliente LAN)
  CreateDirectory "$APPDATA\isaac-pos"
  FileOpen $0 "$APPDATA\isaac-pos\db-config.json" w
  FileWrite $0 '{"mode":"client","dialect":"postgres","host":"","port":5432,"database":"americanpos","user":"postgres","password":"postgres"}'
  FileClose $0

  config_done:
!macroend
