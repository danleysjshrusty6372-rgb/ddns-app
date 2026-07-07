[Setup]
AppName=DDNS Service
AppVersion=4.0.0
AppPublisher=DDNS Team
DefaultDirName={pf}\DDNS Service
DefaultGroupName=DDNS Service
OutputDir=dist
OutputBaseFilename=DDNS-Service-Setup
Compression=lzma
SolidCompression=yes

[Files]
Source: "dist\DDNS-Service-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\DDNS Service"; Filename: "{app}\DDNS-Service.exe"
Name: "{group}\Uninstall DDNS Service"; Filename: "{uninstallexe}"
Name: "{commondesktop}\DDNS Service"; Filename: "{app}\DDNS-Service.exe"

[Run]
Filename: "{app}\DDNS-Service.exe"; Description: "Launch DDNS Service"; Flags: nowait postinstall skipifsilent
