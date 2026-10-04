import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AvAError } from './types.js';

// Fresh ACL, protected from inherited rules, granting only the current Windows SID.
// A path travels in the child environment, never interpolated into PowerShell code.
// The DACL is written first, with the owner's implicit WRITE_DAC: an owner with only Modify rights (the default on a
// second drive) lacks WRITE_OWNER. That DACL gives this account full control, so an owner that isn't this account (an
// elevated administrator's new files belong to the Administrators group) is then replaced in a second write.
// .NET only, no cmdlets: a cmdlet makes Windows PowerShell load its module, and with no module cache (a new profile, or
// a fresh LOCALAPPDATA) that means scanning every installed module first, which took over 10 s a call on CI.
const ACL_SCRIPT=`$ErrorActionPreference='Stop'
$path=$env:AVA_PRIVATE_PATH
$dir=[System.IO.Directory]::Exists($path)
$item=if($dir){[System.IO.DirectoryInfo]::new($path)}else{[System.IO.FileInfo]::new($path)}
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$owner=$item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner).GetOwner([System.Security.Principal.SecurityIdentifier])
$type=if($dir){[System.Security.AccessControl.DirectorySecurity]}else{[System.Security.AccessControl.FileSecurity]}
$rule=if($dir){[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')}
$acl=$type::new()
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule($rule)
$item.SetAccessControl($acl)
if(-not $sid.Equals($owner)){$own=$type::new();$own.SetOwner($sid);$item.SetAccessControl($own)}`;

export function protectPrivatePath(path: string) {
  const info=lstatSync(path);
  if(info.isSymbolicLink()||info.isFile()&&info.nlink>1||!info.isFile()&&!info.isDirectory())throw new AvAError('PRIVATE_FILE','Refused a linked or special private path.');
  if(process.platform!=='win32'){chmodSync(path,info.isDirectory()?0o700:0o600);return;}
  try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ACL_SCRIPT],{env:{...process.env,AVA_PRIVATE_PATH:path},windowsHide:true,timeout:30000,stdio:'pipe'});}
  catch(error){
    const output=error as {stderr?:Buffer|string;code?:string;signal?:string};
    const reason=String(output.stderr??'').split(/\r?\n/).map(line=>line.trim()).find(Boolean)??output.code??output.signal??'unknown error';
    throw new AvAError('PRIVATE_FILE',`Could not restrict ${path} to your Windows account (${reason.slice(0,240)}). No new secret was written.`);
  }
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
