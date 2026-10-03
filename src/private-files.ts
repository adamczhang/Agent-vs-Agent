import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AvAError } from './types.js';

// Fresh ACL, protected from inherited rules, granting only the current Windows SID.
// A path travels in the child environment, never interpolated into PowerShell code.
const ACL_SCRIPT=`$ErrorActionPreference='Stop'
$item=Get-Item -Force -LiteralPath $env:AVA_PRIVATE_PATH
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
if($item.PSIsContainer){
  $acl=New-Object System.Security.AccessControl.DirectorySecurity
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
}else{
  $acl=New-Object System.Security.AccessControl.FileSecurity
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule($rule)
$item.SetAccessControl($acl)`;

export function protectPrivatePath(path: string) {
  const info=lstatSync(path);
  if(info.isSymbolicLink()||info.isFile()&&info.nlink>1||!info.isFile()&&!info.isDirectory())throw new AvAError('PRIVATE_FILE','Refused a linked or special private path.');
  if(process.platform!=='win32'){chmodSync(path,info.isDirectory()?0o700:0o600);return;}
  try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ACL_SCRIPT],{env:{...process.env,AVA_PRIVATE_PATH:path},windowsHide:true,timeout:30000,stdio:'pipe'});}
  catch{throw new AvAError('PRIVATE_FILE','Could not restrict the private file to your Windows account. No new secret was written.');}
}

export function writePrivateFile(path: string, content: string, privateDirectory=false) {
  mkdirSync(dirname(path),{recursive:true});
  if(privateDirectory)protectPrivatePath(dirname(path));
  if(existsSync(path))protectPrivatePath(path);
  // Create empty first; restrict access before writing secret bytes. Rewrites also repair old ACLs.
  closeSync(openSync(path,'a',0o600));
  protectPrivatePath(path);
  writeFileSync(path,content,{mode:0o600});
}
