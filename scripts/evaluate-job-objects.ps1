param([string]$Out = 'pilot-evidence/stage-d/u3-job-objects.json')
$ErrorActionPreference='Stop'
if (-not $IsWindows) { throw 'This evaluation runs on Windows only.' }
# Creates only its own two idle Node processes. No provider, profile or conversation data is used.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class AvAJobProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Basic {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] public struct Extended {
    public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref Extended data,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool result){if(!result)throw new Win32Exception(Marshal.GetLastWin32Error());}
  public static bool[] Run(string node){
    IntPtr job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
    Process parent=null,child=null;
    try{
      var limits=new Extended();limits.Basic.Flags=0x2000|0x200;limits.JobMemory=new UIntPtr(268435456);
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf<Extended>()));
      var start=new ProcessStartInfo(node){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardInput=true,RedirectStandardOutput=true};
      start.ArgumentList.Add("-e");
      start.ArgumentList.Add("process.stdin.once('data',()=>{const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(c.pid);});setInterval(()=>{},1000);");
      parent=Process.Start(start);bool inheritedJob;Check(IsProcessInJob(parent.Handle,IntPtr.Zero,out inheritedJob));
      Check(AssignProcessToJobObject(job,parent.Handle));
      // Start the descendant only after assignment, so the probe itself has no assignment race.
      parent.StandardInput.WriteLine("spawn");parent.StandardInput.Flush();
      var line=parent.StandardOutput.ReadLineAsync();if(!line.Wait(5000))throw new Exception("Probe child did not start");
      child=Process.GetProcessById(int.Parse(line.Result));bool childInJob;Check(IsProcessInJob(child.Handle,job,out childInJob));
      Check(CloseHandle(job));job=IntPtr.Zero;
      return new[]{inheritedJob,childInJob,parent.WaitForExit(5000),child.WaitForExit(5000)};
    }finally{
      if(job!=IntPtr.Zero)CloseHandle(job);
      foreach(var process in new[]{parent,child})if(process!=null){try{if(!process.HasExited)process.Kill(true);}catch{}process.Dispose();}
    }
  }
}
'@
$checks=[AvAJobProbe]::Run((Get-Command node).Source)
if (-not ($checks[1] -and $checks[2] -and $checks[3])) { throw 'Job ownership or cleanup check failed.' }
$result=[ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');status='passed';inheritedOuterJob=$checks[0];descendantInheritedJob=$checks[1];parentStoppedOnClose=$checks[2];descendantStoppedOnClose=$checks[3];configuredJobMemoryBytes=268435456;memoryExhaustionTested=$false;providerRequests=0;productionEnabled=$false}
$target=[IO.Path]::GetFullPath($Out)
if(Test-Path -LiteralPath $target){throw 'Evidence already exists; choose a new output path.'}
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
[IO.File]::WriteAllText($target,($result|ConvertTo-Json).Replace("`r`n","`n")+"`n")
$result | ConvertTo-Json -Compress
