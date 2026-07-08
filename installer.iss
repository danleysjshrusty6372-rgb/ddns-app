[Setup]
AppName=DDNS Service
AppVersion=4.2.0
AppPublisher=DDNS Team
AppId={{B7E5C3A1-D4F2-4E8A-9C6B-1A3F5D7E9B2C}
DefaultDirName={autopf}\DDNS Service
DefaultGroupName=DDNS Service
OutputDir=dist
OutputBaseFilename=DDNS-Service-Setup-v4.2.0
SetupIconFile=electron\icon.ico
UninstallIconFile=electron\icon.ico
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Files]
Source: "dist\DDNS-Service-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Desktop shortcut
Name: "{commondesktop}\DDNS Service"; Filename: "{app}\DDNS-Service.exe"
; Start Menu
Name: "{group}\DDNS Service"; Filename: "{app}\DDNS-Service.exe"
Name: "{group}\卸载 DDNS Service"; Filename: "{uninstallexe}"

[Registry]
; Auto-start with Windows (current user)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DDNSService"; ValueData: """{app}\DDNS-Service.exe"""; Flags: uninsdeletevalue

[Run]
; Launch after install
Filename: "{app}\DDNS-Service.exe"; Description: "启动 DDNS Service"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Ensure the app is closed before uninstall
Filename: "{cmd}"; Parameters: "/C taskkill /F /IM DDNS-Service.exe 2>nul"; Flags: runhidden
