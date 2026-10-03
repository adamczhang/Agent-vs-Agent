import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {writePrivateFile} from '../src/private-files.js';
import {tempDir} from './temp.js';

const powershell=(script:string,path:string)=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,AVA_ACL_TEST:path},encoding:'utf8',windowsHide:true});
function assertOnlyCurrentAccount(path:string,file:boolean){
  if(process.platform!=='win32'){assert.equal(statSync(path).mode&0o777,file?0o600:0o700);return;}
  const script=`$a=(Get-Item -LiteralPath $env:AVA_ACL_TEST).GetAccessControl(); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [pscustomobject]@{protected=$a.AreAccessRulesProtected; owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; sid=$sid; rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Value;allow=$_.AccessControlType.ToString();inherited=$_.IsInherited}})}|ConvertTo-Json -Compress`;
  const acl=JSON.parse(powershell(script,path));
  assert.equal(acl.protected,true);assert.equal(acl.owner,acl.sid);
  assert.deepEqual(acl.rules,[{sid:acl.sid,allow:'Allow',inherited:false}]);
}

test('secret writes and rewrites leave only the current account with access',()=>{
  const root=tempDir('ava-private-'),file=join(root,'secrets','key.json');
  for(const value of ['test-secret','updated-test-secret']){
    writePrivateFile(file,value,true);
    assert.equal(readFileSync(file,'utf8'),value);
    for(const path of [join(root,'secrets'),file])assertOnlyCurrentAccount(path,path===file);
  }
});

// A data folder on a second drive: the account owns what it creates but holds only Modify, not WRITE_OWNER (the default
// NTFS rights below a drive root). Securing a secret must not need to take ownership it already has.
test('secrets are secured in a folder where the owner has only Modify rights',{skip:process.platform!=='win32'&&'Windows ACLs'},()=>{
  const root=tempDir('ava-private-modify-'),file=join(root,'secrets','key.json');
  powershell(`$ErrorActionPreference='Stop'
$item=Get-Item -LiteralPath $env:AVA_ACL_TEST
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'Modify','ContainerInherit,ObjectInherit','None','Allow')))
$item.SetAccessControl($acl)`,root);
  writePrivateFile(join(root,'server.json'),'{}');
  assertOnlyCurrentAccount(join(root,'server.json'),true);
  writePrivateFile(file,'test-secret',true);
  for(const path of [join(root,'secrets'),file])assertOnlyCurrentAccount(path,path===file);
  assert.equal(readFileSync(file,'utf8'),'test-secret');
});
