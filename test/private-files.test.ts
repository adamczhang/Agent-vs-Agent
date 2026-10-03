import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {writePrivateFile} from '../src/private-files.js';
import {tempDir} from './temp.js';

test('secret writes and rewrites leave only the current account with access',()=>{
  const root=tempDir('ava-private-'),file=join(root,'secrets','key.json');
  for(const value of ['test-secret','updated-test-secret']){
    writePrivateFile(file,value,true);
    assert.equal(readFileSync(file,'utf8'),value);
    for(const path of [join(root,'secrets'),file]){
      if(process.platform==='win32'){
        const script=`$a=(Get-Item -LiteralPath $env:AVA_ACL_TEST).GetAccessControl(); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [pscustomobject]@{protected=$a.AreAccessRulesProtected; owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; sid=$sid; rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Value;allow=$_.AccessControlType.ToString();inherited=$_.IsInherited}})}|ConvertTo-Json -Compress`;
        const acl=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,AVA_ACL_TEST:path},encoding:'utf8',windowsHide:true}));
        assert.equal(acl.protected,true);assert.equal(acl.owner,acl.sid);
        assert.deepEqual(acl.rules,[{sid:acl.sid,allow:'Allow',inherited:false}]);
      }else assert.equal(statSync(path).mode&0o777,path===file?0o600:0o700);
    }
  }
});
