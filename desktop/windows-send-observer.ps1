# ASCII source is intentional: Windows PowerShell 5.1 does not assume UTF-8.
# Read-only Windows UI Automation. Never activates a control or reads editor text.
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]{1,64}$')][string]$ObserverId,
 [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ParentPid,
 [ValidateRange(0,20)][int]$DurationSeconds=0,
 [ValidateRange(5000,30000)][int]$PresentationTotalMs=11300
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
 Add-Type -AssemblyName UIAutomationClient
 Add-Type -AssemblyName UIAutomationTypes
 Add-Type -AssemblyName WindowsBase
 Add-Type -ReferencedAssemblies System.dll,System.Core.dll,UIAutomationClient,UIAutomationTypes,WindowsBase -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

// Minimal read-only declarations checked against Windows SDK 10.0.22621.0
// um/UIAutomationClient.idl. Unused slots are never called. No extra DLL required.
// https://learn.microsoft.com/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomation
[ComImport,Guid("352ffba8-0973-437c-a61f-f64cafd81df9"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface SendCondition {}
[ComImport,Guid("14314595-b4bc-4055-95f2-58f2e42c9855"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface SendElementArray {
 [PreserveSig] int Length(out int length);
 [PreserveSig] int GetElement(int index,out SendElement element);
}
[ComImport,Guid("4042c624-389c-4afc-a630-9df854a541fc"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface SendTreeWalker {
 [PreserveSig] int Parent(SendElement element,out SendElement parent);
}
[ComImport,Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface SendElement {
 [PreserveSig] int Unused0();
 [PreserveSig] int GetRuntimeId([MarshalAs(UnmanagedType.SafeArray,SafeArraySubType=VarEnum.VT_I4)]out int[] id);
 [PreserveSig] int Unused2();
 [PreserveSig] int FindAll(int scope,SendCondition condition,out SendElementArray elements);
 [PreserveSig] int Unused4(); [PreserveSig] int Unused5(); [PreserveSig] int Unused6();
 [PreserveSig] int Unused7();
 [PreserveSig] int Property(int id,[MarshalAs(UnmanagedType.Bool)]bool noDefault,[MarshalAs(UnmanagedType.Struct)]out object value);
}
[ComImport,Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface SendAutomation {
 [PreserveSig] int Unused0(); [PreserveSig] int Unused1(); [PreserveSig] int Unused2();
 [PreserveSig] int ElementFromHandle(IntPtr hwnd,out SendElement element);
 [PreserveSig] int Unused4(); [PreserveSig] int Unused5(); [PreserveSig] int Unused6();
 [PreserveSig] int Unused7(); [PreserveSig] int Unused8(); [PreserveSig] int Unused9();
 [PreserveSig] int Unused10(); [PreserveSig] int ControlViewWalker(out SendTreeWalker walker); [PreserveSig] int Unused12();
 [PreserveSig] int Unused13(); [PreserveSig] int Unused14(); [PreserveSig] int Unused15();
 [PreserveSig] int Unused16(); [PreserveSig] int Unused17(); [PreserveSig] int Unused18(); [PreserveSig] int Unused19();
 [PreserveSig] int PropertyCondition(int id,[MarshalAs(UnmanagedType.Struct)]object value,out SendCondition condition);
 [PreserveSig] int Unused21();
 [PreserveSig] int And(SendCondition left,SendCondition right,out SendCondition condition);
 [PreserveSig] int Unused23(); [PreserveSig] int Unused24();
 [PreserveSig] int Or(SendCondition left,SendCondition right,out SendCondition condition);
}
// One provider action per explicitly observed candidate lifecycle. No time debounce.
public sealed class SendArmState {
 readonly object gate=new object();
 readonly string target,composer;readonly long generation;
 bool consumed,retired,sawNotReady,ready=true;
 public SendArmState(string targetId,string composerId,long epoch){
  if(string.IsNullOrEmpty(targetId)||string.IsNullOrEmpty(composerId)||targetId.Length>1024||composerId.Length>2048)throw new ArgumentException();
  target=targetId;composer=composerId;generation=epoch;
 }
 public bool TryConsume(string targetId,string composerId,long epoch){
  lock(gate){if(retired||consumed||target!=targetId||composer!=composerId||generation!=epoch)return false;consumed=true;return true;}
 }
 public void ObserveReady(bool value){lock(gate){ready=value;if(!value)sawNotReady=true;}}
 public bool CanRearm{get{lock(gate){return !retired&&consumed&&sawNotReady&&ready;}}}
 public bool AwaitingLateInvoke{get{lock(gate){return !retired&&!consumed&&sawNotReady;}}}
 public void Retire(){lock(gate){retired=true;}}
}
public static class WindowsSendObserver {
 [StructLayout(LayoutKind.Sequential)]public struct NativeRect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)]public struct Point { public int X,Y; }
 delegate bool EnumCallback(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumCallback callback,IntPtr param);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")]static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")]static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr hwnd,uint command);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")]static extern bool GetClientRect(IntPtr hwnd,out NativeRect rect);
 [DllImport("user32.dll")]static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
 [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern int GetPackageFamilyName(IntPtr process,ref uint length,StringBuilder name);
 sealed class Box {
  public double X,Y,W,H;
  public bool Valid { get { return Finite(X)&&Finite(Y)&&Finite(W)&&Finite(H)&&Math.Abs(X)<=131072&&Math.Abs(Y)<=131072&&W>0&&H>0&&W<=32768&&H<=32768; } }
  public bool Contains(Box other) { return Valid&&other!=null&&other.Valid&&other.X>=X&&other.Y>=Y&&other.X+other.W<=X+W&&other.Y+other.H<=Y+H; }
  public string Json { get { return "{\"x\":"+Num(X)+",\"y\":"+Num(Y)+",\"width\":"+Num(W)+",\"height\":"+Num(H)+"}"; } }
 }
 sealed class Context {
  public Process Process; public int Pid; public long StartTicks; public IntPtr Hwnd; public Box Client,Viewport,Anchor;
  public string Mode; public int[] MainId; public AutomationElement Send,Composer,Editor; public int[] ComposerId,EditorId; public Box ComposerBounds;
  public bool AmbiguousSend;
  public string ComposerKey { get { return IdKey(ComposerId)+"/"+IdKey(EditorId); } }
  public string BaseKey { get { return Pid+":"+StartTicks+":"+Hwnd+":"+Mode+":"+Client.Json+":"+Viewport.Json+":"+IdKey(MainId)+":"+ComposerKey+":"+ComposerBounds.Json; } }
 }
 sealed class Invocation { public Context Context; public Box Anchor; public long At; public int Generation; }
 sealed class Registration {
  public Context Context;public AutomationEventHandler Handler;public AutomationPropertyChangedEventHandler PropertyHandler;
  public int Generation;public string TargetId;public SendArmState Arm;public long RefreshedAt,NonReadyAt=-1;
 }
 sealed class ModeGroup { public bool Chat,Work; public string Selected; public int SelectedCount; }
 static readonly HashSet<string> SendNames=new HashSet<string>(StringComparer.Ordinal){"Send","Send message","Send now","Submit","\u53d1\u9001","\u53d1\u9001\u6d88\u606f","\u7acb\u5373\u53d1\u9001","\u63d0\u4ea4"};
 static readonly HashSet<string> StopNames=new HashSet<string>(StringComparer.Ordinal){"Stop","Stop generating","Stop response","\u505c\u6b62","\u505c\u6b62\u751f\u6210","\u505c\u6b62\u54cd\u5e94"};
 static readonly Dictionary<string,string> ModeNames=new Dictionary<string,string>(StringComparer.Ordinal){
  {"Chat","chat"},{"Chats","chat"},{"ChatGPT","chat"},{"Chat mode","chat"},{"Work","work"},{"Codex","work"},{"Work mode","work"},
  {"\u804a\u5929","chat"},{"\u5de5\u4f5c","work"},{"\u804a\u5929\u6a21\u5f0f","chat"},{"\u5de5\u4f5c\u6a21\u5f0f","work"}};
 static readonly ConcurrentQueue<Invocation> Events=new ConcurrentQueue<Invocation>();
 static readonly Stopwatch Clock=Stopwatch.StartNew();
 static long Sequence; static string ObserverId; static Registration CurrentRegistration; static int Generation;
 static long LastUnavailable=-1000,ActiveUntil;static int PresentationLeaseMs; static string LastReason="",ActiveBase="";
 static bool Finite(double value){return !double.IsNaN(value)&&!double.IsInfinity(value);}
 static string Num(double value){return value.ToString("R",CultureInfo.InvariantCulture);}
 static void Check(int hr){Marshal.ThrowExceptionForHR(hr);}
 static bool Same(int[] a,int[] b){if(a==null||b==null||a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true;}
 static string IdKey(int[] value){return value==null?"":string.Join(",",value);}
 static Box Bounds(System.Windows.Rect rect){return new Box{X=rect.X,Y=rect.Y,W=rect.Width,H=rect.Height};}
 static Box Bounds(object value){var a=value as double[];return a==null||a.Length!=4?null:new Box{X=a[0],Y=a[1],W=a[2],H=a[3]};}
 static object Property(SendElement element,int id){object value;Check(element.Property(id,true,out value));return value;}
 static bool Flag(SendElement element,int id){object value=Property(element,id);return value is bool&&(bool)value;}
 static SendCondition Condition(SendAutomation automation,int id,object value){SendCondition result;Check(automation.PropertyCondition(id,value,out result));return result;}
 static SendCondition Or(SendAutomation automation,SendCondition left,SendCondition right){if(left==null)return right;SendCondition result;Check(automation.Or(left,right,out result));return result;}
 static SendElement[] Find(SendElement root,SendCondition condition,int limit){SendElementArray found;Check(root.FindAll(4,condition,out found));int length;Check(found.Length(out length));if(length>limit)throw new InvalidOperationException();var result=new SendElement[length];for(int i=0;i<length;i++)Check(found.GetElement(i,out result[i]));return result;}
 static string Mode(SendAutomation automation,SendElement root){
  SendCondition names=null,roles=null;
  foreach(string label in ModeNames.Keys)names=Or(automation,names,Condition(automation,30005,label));
  foreach(int type in new[]{50000,50013,50018,50019})roles=Or(automation,roles,Condition(automation,30003,type));
  foreach(string role in new[]{"tab","radio","switch","button"})roles=Or(automation,roles,Condition(automation,30101,role));
  SendCondition condition;Check(automation.And(names,roles,out condition));
  SendTreeWalker walker;Check(automation.ControlViewWalker(out walker));
  var groups=new Dictionary<string,ModeGroup>();
  foreach(SendElement element in Find(root,condition,16)){
   string label=Property(element,30005) as string;string mode;if(label==null||!ModeNames.TryGetValue(label,out mode)||Flag(element,30022)||!Flag(element,30010))continue;
   SendElement parent;Check(walker.Parent(element,out parent));if(parent==null)continue;int[] parentId;Check(parent.GetRuntimeId(out parentId));if(parentId==null)continue;
   string groupKey=string.Join(",",parentId);ModeGroup group;if(!groups.TryGetValue(groupKey,out group)){group=new ModeGroup();groups[groupKey]=group;}
   if(mode=="chat")group.Chat=true;else group.Work=true;
   bool yes=false,no=false;
   if(Flag(element,30036)){if(Flag(element,30079))yes=true;else no=true;}
   if(Flag(element,30041)){object toggle=Property(element,30086);if(toggle is int&&(int)toggle==1)yes=true;else no=true;}
   string aria=Property(element,30102) as string??"";
   if(Regex.IsMatch(aria,@"(^|;)\s*(selected|pressed|checked)=true\s*(;|$)",RegexOptions.IgnoreCase))yes=true;
   if(Regex.IsMatch(aria,@"(^|;)\s*(selected|pressed|checked)=false\s*(;|$)",RegexOptions.IgnoreCase))no=true;
   if(Flag(element,30090)){object state=Property(element,30096);if(state is int&&(((int)state&2)!=0||((int)state&8)!=0||((int)state&16)!=0))yes=true;}
   if(yes&&!no){group.Selected=mode;group.SelectedCount++;}
  }
  string selected=null;int groupsSelected=0;
  foreach(ModeGroup group in groups.Values)if(group.Chat&&group.Work&&group.SelectedCount==1){selected=group.Selected;groupsSelected++;}
  return groupsSelected==1?selected:null;
 }
 static string Family(Process process){uint length=256;var value=new StringBuilder((int)length);return GetPackageFamilyName(process.Handle,ref length,value)==0?value.ToString():"";}
 static Context Host(string installRoot,string family,out string reason){
  reason="host-unavailable";var processes=new Dictionary<int,Process>();
  foreach(string name in new[]{"ChatGPT","Codex"})foreach(Process process in Process.GetProcessesByName(name)){
   try{string executable=Path.GetFullPath(process.MainModule.FileName);if(executable.StartsWith(installRoot,StringComparison.OrdinalIgnoreCase)&&Family(process)==family)processes[process.Id]=process;else process.Dispose();}catch{process.Dispose();}
  }
  var windows=new List<IntPtr>();
  EnumWindows((hwnd,param)=>{uint pid;GetWindowThreadProcessId(hwnd,out pid);if(processes.ContainsKey((int)pid)&&IsWindowVisible(hwnd)&&GetWindow(hwnd,4)==IntPtr.Zero)windows.Add(hwnd);return windows.Count<17;},IntPtr.Zero);
  if(windows.Count!=1){reason=windows.Count>1?"host-ambiguous":"host-unavailable";foreach(Process p in processes.Values)p.Dispose();return null;}
  uint owner;GetWindowThreadProcessId(windows[0],out owner);Process target=processes[(int)owner];foreach(Process p in processes.Values)if(p!=target)p.Dispose();
  var context=new Context{Process=target,Pid=target.Id,StartTicks=target.StartTime.ToUniversalTime().Ticks,Hwnd=windows[0]};
  if(IsIconic(context.Hwnd)){reason="window-minimized";target.Dispose();return null;}
  if(GetForegroundWindow()!=context.Hwnd){reason="window-inactive";target.Dispose();return null;}
  NativeRect rectangle;Point point=new Point();
  if(!IsWindow(context.Hwnd)||!GetClientRect(context.Hwnd,out rectangle)||!ClientToScreen(context.Hwnd,ref point)){reason="window-unavailable";target.Dispose();return null;}
  context.Client=new Box{X=point.X,Y=point.Y,W=rectangle.Right-rectangle.Left,H=rectangle.Bottom-rectangle.Top};
  if(!context.Client.Valid){reason="geometry-invalid";target.Dispose();return null;}
  return context;
 }
 static bool MainRegion(Context context,SendAutomation automation,SendElement root){
  // These are SDK constants, not guessed property IDs. Both select the same semantic region.
  var regions=Find(root,Or(automation,Condition(automation,30101,"main"),Condition(automation,30157,80002)),8);
  if(regions.Length!=1||Flag(regions[0],30022))return false;
  Box rectangle=Bounds(Property(regions[0],30001));if(!context.Client.Contains(rectangle))return false;
  context.Viewport=rectangle;Check(regions[0].GetRuntimeId(out context.MainId));return context.MainId!=null;
 }
 static bool InMain(AutomationElement element,Context context){
  AutomationElement ancestor=element;
  for(int depth=0;depth<16&&ancestor!=null;depth++){
   if(Same(ancestor.GetRuntimeId(),context.MainId))return true;
   ancestor=TreeWalker.ControlViewWalker.GetParent(ancestor);
  }
  return false;
 }
 static bool ReadComposer(Context context){
  AutomationElement root=AutomationElement.FromHandle(context.Hwnd);if(root.Current.ProcessId!=context.Pid)return false;
  var edits=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));
  if(edits.Count>16)return false;int count=0;
  for(int index=0;index<edits.Count;index++){
   AutomationElement editor=edits[index];if(editor.Current.IsOffscreen||!context.Viewport.Contains(Bounds(editor.Current.BoundingRectangle)))continue;
   AutomationElement parent=TreeWalker.ControlViewWalker.GetParent(editor);
   if(parent==null||parent.Current.ControlType!=ControlType.Group||Same(parent.GetRuntimeId(),context.MainId)||parent.Current.IsOffscreen||!InMain(parent,context))continue;
   Box bounds=Bounds(parent.Current.BoundingRectangle);if(!context.Viewport.Contains(bounds))continue;
   var siblings=parent.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));
   if(siblings.Count!=1)continue;
   context.Composer=parent;context.Editor=editor;context.ComposerId=parent.GetRuntimeId();context.EditorId=editor.GetRuntimeId();context.ComposerBounds=bounds;count++;
  }
  return count==1;
 }
 static bool Send(Context context){
  AutomationElement root=AutomationElement.FromHandle(context.Hwnd);if(root.Current.ProcessId!=context.Pid)return false;
  var labels=new List<Condition>();foreach(string name in SendNames)labels.Add(new PropertyCondition(AutomationElement.NameProperty,name));
  var condition=new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new OrCondition(labels.ToArray()));
  var matches=root.FindAll(TreeScope.Descendants,condition);if(matches.Count>16){context.AmbiguousSend=true;return false;}int count=0;
  AutomationElement selected=null;Box selectedAnchor=null;
  for(int index=0;index<matches.Count;index++){
   AutomationElement button=matches[index];object pattern;Box anchor=Bounds(button.Current.BoundingRectangle);
   if(!button.Current.IsEnabled||button.Current.IsOffscreen||!context.Client.Contains(anchor)||!InMain(button,context)||!button.TryGetCurrentPattern(InvokePattern.Pattern,out pattern))continue;
   AutomationElement parent=TreeWalker.ControlViewWalker.GetParent(button);if(parent==null||!Same(parent.GetRuntimeId(),context.ComposerId))continue;
   selected=button;selectedAnchor=anchor;count++;
  }
  context.AmbiguousSend=count>1;if(count!=1)return false;context.Send=selected;context.Anchor=selectedAnchor;return true;
 }
 static string BaseLine(string kind){return "{\"schemaVersion\":1,\"kind\":\""+kind+"\",\"observerId\":\""+ObserverId+"\",\"sequence\":"+(++Sequence)+",\"monotonicMs\":"+Clock.ElapsedMilliseconds;}
 static string HostJson(Context context){return "{\"package\":\"OpenAI.Codex\",\"pid\":"+context.Pid+",\"hwnd\":\""+context.Hwnd.ToInt64()+"\"}";}
 static void Write(string line){if(Encoding.UTF8.GetByteCount(line)>16384)return;Console.Out.WriteLine(line);Console.Out.Flush();}
 static void Unavailable(string reason){if(reason==LastReason&&Clock.ElapsedMilliseconds-LastUnavailable<1000)return;LastReason=reason;LastUnavailable=Clock.ElapsedMilliseconds;Write(BaseLine("unavailable")+",\"reason\":\""+reason+"\"}");}
 static void RemoveRegistration(){
  Registration old=CurrentRegistration;CurrentRegistration=null;Interlocked.Increment(ref Generation);
  if(old!=null){
   old.Arm.Retire();
   try{Automation.RemoveAutomationEventHandler(InvokePattern.InvokedEvent,old.Context.Send,old.Handler);}catch{}
   try{Automation.RemoveAutomationPropertyChangedEventHandler(old.Context.Send,old.PropertyHandler);}catch{}
  }
  Invocation ignored;while(Events.TryDequeue(out ignored)){}
 }
 static void NotReady(Registration registration){registration.Arm.ObserveReady(false);Interlocked.CompareExchange(ref registration.NonReadyAt,Clock.ElapsedMilliseconds,-1);}
 static Context ArmedContext(Context context,AutomationElement send,Box anchor){
  return new Context{Process=context.Process,Pid=context.Pid,StartTicks=context.StartTicks,Hwnd=context.Hwnd,Client=context.Client,Viewport=context.Viewport,
   Mode=context.Mode,MainId=context.MainId,Composer=context.Composer,Editor=context.Editor,ComposerId=context.ComposerId,EditorId=context.EditorId,ComposerBounds=context.ComposerBounds,Send=send,Anchor=anchor};
 }
 static void RefreshRegistration(Context context,bool hasSend){
  Registration registration=CurrentRegistration;if(registration==null)return;
  if(registration.Context.BaseKey!=context.BaseKey){Unavailable("geometry-changed");ActiveUntil=0;RemoveRegistration();return;}
  if(context.AmbiguousSend){RemoveRegistration();Unavailable("send-unavailable");return;}
  try{
   if(hasSend&&!Automation.Compare(registration.Context.Send,context.Send)){Unavailable("geometry-changed");ActiveUntil=0;RemoveRegistration();return;}
   AutomationElement target=registration.Context.Send;string name=target.Current.Name;
   if((!SendNames.Contains(name)&&!StopNames.Contains(name))||target.Current.IsOffscreen){RemoveRegistration();Unavailable("send-unavailable");return;}
   Box anchor=Bounds(target.Current.BoundingRectangle);
   if(!context.Client.Contains(anchor)||anchor.Json!=registration.Context.Anchor.Json){Unavailable("geometry-changed");ActiveUntil=0;RemoveRegistration();return;}
   if(SendNames.Contains(name)&&target.Current.IsEnabled)registration.Arm.ObserveReady(true);else NotReady(registration);
   registration.Context=ArmedContext(context,target,anchor);Interlocked.Exchange(ref registration.RefreshedAt,Clock.ElapsedMilliseconds);
  }catch{RemoveRegistration();Unavailable("send-unavailable");}
 }
 static void Subscribe(Context context){
  if(CurrentRegistration!=null&&Automation.Compare(CurrentRegistration.Context.Send,context.Send)){
   CurrentRegistration.Arm.ObserveReady(true);
   if(!CurrentRegistration.Arm.CanRearm){CurrentRegistration.Context=context;Interlocked.Exchange(ref CurrentRegistration.RefreshedAt,Clock.ElapsedMilliseconds);return;}
  }
  RemoveRegistration();var registration=new Registration{Context=context,Generation=Generation,TargetId=IdKey(context.Send.GetRuntimeId()),RefreshedAt=Clock.ElapsedMilliseconds};
  registration.Arm=new SendArmState(registration.TargetId,context.ComposerKey,registration.Generation);
  registration.Handler=(sender,args)=>{
   try{
    Context current=registration.Context;
    if(CurrentRegistration!=registration||args.EventId!=InvokePattern.InvokedEvent||Events.Count>=64||Clock.ElapsedMilliseconds-Interlocked.Read(ref registration.RefreshedAt)>2000||IsIconic(current.Hwnd)||GetForegroundWindow()!=current.Hwnd)return;
    // Scope.Element is bound to the verified target. Consume its arm once; live
    // Name/Enabled may already describe the subsequent Stop state, not this Invoke.
    if(!registration.Arm.TryConsume(registration.TargetId,current.ComposerKey,registration.Generation))return;
    Events.Enqueue(new Invocation{Context=current,Anchor=current.Anchor,At=Clock.ElapsedMilliseconds,Generation=registration.Generation});
   }catch{}
  };
  registration.PropertyHandler=(sender,args)=>{
   if(CurrentRegistration!=registration)return;
   if(args.Property==AutomationElement.NameProperty){
    string name=args.NewValue as string;
    if(name!=null&&StopNames.Contains(name))NotReady(registration);
    else if(name==null||!SendNames.Contains(name))registration.Arm.Retire();
   }else if(args.Property==AutomationElement.IsEnabledProperty&&args.NewValue is bool&&!(bool)args.NewValue)NotReady(registration);
  };
  CurrentRegistration=registration;
  try{
   Automation.AddAutomationEventHandler(InvokePattern.InvokedEvent,context.Send,TreeScope.Element,registration.Handler);
   Automation.AddAutomationPropertyChangedEventHandler(context.Send,TreeScope.Element,registration.PropertyHandler,AutomationElement.NameProperty,AutomationElement.IsEnabledProperty);
  }catch{RemoveRegistration();throw;}
 }
 static void Drain(Context current){
  Invocation invocation;while(Events.TryDequeue(out invocation)){
   if(invocation.Generation!=Generation||Clock.ElapsedMilliseconds-invocation.At>2000||current.BaseKey!=invocation.Context.BaseKey)continue;
   uint owner;GetWindowThreadProcessId(current.Hwnd,out owner);
   if(owner!=current.Pid||current.Process.HasExited||current.Process.StartTime.ToUniversalTime().Ticks!=current.StartTicks||IsIconic(current.Hwnd)||GetForegroundWindow()!=current.Hwnd)continue;
   Write(BaseLine("send-invoked")+",\"host\":"+HostJson(current)+",\"mode\":{\"value\":\""+current.Mode+"\",\"source\":\"explicit-selection\"},\"coordinateSpace\":\"physical-screen-px\",\"anchor\":"+invocation.Anchor.Json+",\"viewport\":"+current.Viewport.Json+",\"evidence\":{\"invoke\":true,\"composerBound\":true,\"foreground\":true,\"minimized\":false}}");
   ActiveUntil=Clock.ElapsedMilliseconds+PresentationLeaseMs;ActiveBase=current.BaseKey;
  }
 }
 public static void Run(string observerId,int parentPid,string installRoot,string family,int durationSeconds,int presentationTotalMs){
  if(presentationTotalMs<5000||presentationTotalMs>30000)throw new ArgumentOutOfRangeException();
  ObserverId=observerId;PresentationLeaseMs=presentationTotalMs;IntPtr previousDpi=IntPtr.Zero;
  var parent=Process.GetProcessById(parentPid);var watcher=new Thread(()=>{try{parent.WaitForExit();Environment.Exit(0);}catch{Environment.Exit(0);}});watcher.IsBackground=true;watcher.Start();
  try{
   previousDpi=SetThreadDpiAwarenessContext(new IntPtr(-4));
   var automation=(SendAutomation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e")));
   string lastBase="";int warmup=0;
   while(durationSeconds==0||Clock.ElapsedMilliseconds<durationSeconds*1000L){
    Context context=null;bool ready=false;
    try{
     string reason;context=Host(installRoot,family,out reason);
     if(context==null){RemoveRegistration();ActiveUntil=0;lastBase="";Unavailable(reason);}
     else{
      SendElement nativeRoot;Check(automation.ElementFromHandle(context.Hwnd,out nativeRoot));context.Mode=Mode(automation,nativeRoot);
      if(context.Mode==null){RemoveRegistration();ActiveUntil=0;lastBase="";Unavailable("mode-unknown");}
      else if(!MainRegion(context,automation,nativeRoot)){RemoveRegistration();ActiveUntil=0;lastBase="";Unavailable("viewport-unavailable");}
      else if(!ReadComposer(context)){RemoveRegistration();ActiveUntil=0;lastBase="";Unavailable("geometry-changed");}
      else{
       if(lastBase!=""&&lastBase!=context.BaseKey){Unavailable(CurrentRegistration!=null&&CurrentRegistration.Context.Mode!=context.Mode?"mode-changed":"geometry-changed");RemoveRegistration();ActiveUntil=0;}
       lastBase=context.BaseKey;bool hasSend=Send(context);RefreshRegistration(context,hasSend);Drain(context);
       if(hasSend){Subscribe(context);ready=true;}
       else{
        Registration registration=CurrentRegistration;
        bool awaiting=registration!=null&&registration.Arm.AwaitingLateInvoke&&Interlocked.Read(ref registration.NonReadyAt)>=0&&Clock.ElapsedMilliseconds-Interlocked.Read(ref registration.NonReadyAt)<=2000;
        if(!awaiting&&(Clock.ElapsedMilliseconds>=ActiveUntil||ActiveBase!=context.BaseKey)){RemoveRegistration();Unavailable("send-unavailable");}
       }
       // Send -> Stop after a real invocation only disables the next subscription.
       // The confirmed host/mode/main context is still re-read on every cycle.
      }
     }
    }catch{RemoveRegistration();ActiveUntil=0;lastBase="";Unavailable("observer-unavailable");}
    finally{if(context!=null)context.Process.Dispose();}
    // This is the sole heartbeat site. A blocked UIA call cannot keep it alive.
    Write(BaseLine("health")+"}");
    Thread.Sleep(ready||warmup++<2?250:1000);
   }
  }finally{RemoveRegistration();if(previousDpi!=IntPtr.Zero)SetThreadDpiAwarenessContext(previousDpi);parent.Dispose();}
 }
}
'@
 $packages=@(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -ceq 'OpenAI.Codex_2p2nqsd0c76g0' })
 if($packages.Count -ne 1){throw 'identity-unverified'}
 $installRoot=[IO.Path]::GetFullPath($packages[0].InstallLocation).TrimEnd('\')+'\'
 [WindowsSendObserver]::Run($ObserverId,$ParentPid,$installRoot,$packages[0].PackageFamilyName,$DurationSeconds,$PresentationTotalMs)
} catch {
 # Never forward provider exception text, paths, or raw property values.
 [ordered]@{schemaVersion=1;kind='unavailable';observerId=$ObserverId;sequence=1;monotonicMs=0;reason='observer-unavailable'} | ConvertTo-Json -Compress
}
