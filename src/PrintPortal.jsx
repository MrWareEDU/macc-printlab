import { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

// ─── Storage ──────────────────────────────────────────────────────────────────
var RK = "pl_reqs_v7";
var AK = "pl_admins_v2";
var IK = "pl_inv_v2";
var SK = "pl_settings_v1";
var TK = "pl_templates_v1";

async function sget(k) { try { var r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch(e) { return null; } }
async function sset(k, v) { try { await window.storage.set(k, JSON.stringify(v)); } catch(e) {} }
async function loadReqs() { return (await sget(RK)) || []; }
async function saveReqs(r) { await sset(RK, r); }
async function loadInv() { return (await sget(IK)) || buildDefaultInv(); }
async function saveInv(i) { await sset(IK, i); }
async function loadSettings() { return (await sget(SK)) || { printerIp: "", printerCode: "", printerModel: "Bambu X1C", darkMode: true }; }
async function saveSettings(s) { await sset(SK, s); }
async function loadTemplates() { return (await sget(TK)) || []; }
async function saveTemplates(t) { await sset(TK, t); }

// ─── Constants ────────────────────────────────────────────────────────────────
var SPOOL_G = 1000;
var LOW_G = 250;
var CRIT_G = 100;
var DENSITIES = { PLA: 1.24, PETG: 1.27, ABS: 1.05, TPU: 1.21 };
var DEPARTMENTS = ["TAS", "Mathematics", "English", "Science", "CAPA", "HSIE", "PDHPE", "Modern Languages", "Other"];
var STATUSES = ["Queued", "Printing", "Done", "Cancelled"];
var SC = { Queued: "#f59e0b", Printing: "#3b82f6", Done: "#22c55e", Cancelled: "#4b5563" };
var CHART_COLORS = ["#f97316","#3b82f6","#22c55e","#a855f7","#ec4899","#f59e0b","#06b6d4","#84cc16"];

// Bambu X1C build volume (mm)
var BUILD_VOL = { x: 256, y: 256, z: 256 };

var DEFAULT_ADMINS = [
  { email: "robertw@macc.nsw.edu.au", name: "Robert W.", role: "Admin", password: "Orbit#4821", mustReset: true },
  { email: "thomas.rodriguez@macc.nsw.edu.au", name: "Thomas Rodriguez", role: "Head of STEM", password: "Prism#7364", mustReset: true }
];
async function loadAdmins() { var s = await sget(AK); if (!s) { await sset(AK, DEFAULT_ADMINS); return DEFAULT_ADMINS; } return s; }
async function saveAdmins(a) { await sset(AK, a); }

var BAMBU = [
  { id:"pla-white",  type:"PLA Basic",  material:"PLA",  color:"White",  hex:"#f5f5f4", price:24.99, density:1.24 },
  { id:"pla-black",  type:"PLA Basic",  material:"PLA",  color:"Black",  hex:"#1c1c1c", price:24.99, density:1.24 },
  { id:"pla-gray",   type:"PLA Basic",  material:"PLA",  color:"Gray",   hex:"#9ca3af", price:24.99, density:1.24 },
  { id:"pla-red",    type:"PLA Basic",  material:"PLA",  color:"Red",    hex:"#ef4444", price:24.99, density:1.24 },
  { id:"pla-blue",   type:"PLA Basic",  material:"PLA",  color:"Blue",   hex:"#3b82f6", price:24.99, density:1.24 },
  { id:"pla-green",  type:"PLA Basic",  material:"PLA",  color:"Green",  hex:"#22c55e", price:24.99, density:1.24 },
  { id:"pla-yellow", type:"PLA Basic",  material:"PLA",  color:"Yellow", hex:"#eab308", price:24.99, density:1.24 },
  { id:"pla-orange", type:"PLA Basic",  material:"PLA",  color:"Orange", hex:"#f97316", price:24.99, density:1.24 },
  { id:"plam-white", type:"PLA Matte",  material:"PLA",  color:"White",  hex:"#f0ede8", price:28.99, density:1.24 },
  { id:"plam-black", type:"PLA Matte",  material:"PLA",  color:"Black",  hex:"#2a2525", price:28.99, density:1.24 },
  { id:"plap-white", type:"PLA+",       material:"PLA",  color:"White",  hex:"#ffffff", price:29.99, density:1.24 },
  { id:"plap-black", type:"PLA+",       material:"PLA",  color:"Black",  hex:"#111111", price:29.99, density:1.24 },
  { id:"silk-gold",  type:"PLA Silk",   material:"PLA",  color:"Gold",   hex:"#d4a017", price:32.99, density:1.24 },
  { id:"silk-silv",  type:"PLA Silk",   material:"PLA",  color:"Silver", hex:"#c0c0c0", price:32.99, density:1.24 },
  { id:"petg-white", type:"PETG Basic", material:"PETG", color:"White",  hex:"#f8f8f8", price:27.99, density:1.27 },
  { id:"petg-black", type:"PETG Basic", material:"PETG", color:"Black",  hex:"#1a1a1a", price:27.99, density:1.27 },
  { id:"petg-clear", type:"PETG Basic", material:"PETG", color:"Clear",  hex:"#dbeafe", price:27.99, density:1.27 },
  { id:"abs-white",  type:"ABS",        material:"ABS",  color:"White",  hex:"#f5f5f0", price:26.99, density:1.05 },
  { id:"abs-black",  type:"ABS",        material:"ABS",  color:"Black",  hex:"#1a1a1a", price:26.99, density:1.05 },
  { id:"tpu-black",  type:"TPU 95A",    material:"TPU",  color:"Black",  hex:"#1a1a1a", price:39.99, density:1.21 },
  { id:"tpu-white",  type:"TPU 95A",    material:"TPU",  color:"White",  hex:"#f5f5f5", price:39.99, density:1.21 }
];

function buildDefaultInv() {
  var active = ["pla-white","pla-black","pla-gray","pla-red","pla-blue","pla-green","pla-orange","petg-white","petg-black","abs-white","tpu-black"];
  return BAMBU.map(function(f) { return Object.assign({}, f, { enabled: active.indexOf(f.id) >= 0, spoolsOwned: active.indexOf(f.id) >= 0 ? 2 : 0, usedG: 0, custom: false }); });
}

var MATS = [
  { id:"PLA",  emoji:"🟢", name:"PLA",  tag:"Most popular", color:"#22c55e", desc:"Best for classroom projects. Safe, affordable, easy to print." },
  { id:"PETG", emoji:"💧", name:"PETG", tag:"Stronger",     color:"#3b82f6", desc:"Tougher than PLA, slightly water-resistant. Good for durable parts." },
  { id:"ABS",  emoji:"⚙️", name:"ABS",  tag:"Heavy duty",   color:"#f59e0b", desc:"Very strong and heat-resistant. Best for functional parts." },
  { id:"TPU",  emoji:"🤸", name:"TPU",  tag:"Flexible",     color:"#a855f7", desc:"Bendy and rubbery — great for phone cases, grips, and flex parts." }
];
var COLORS = [
  { name:"White", hex:"#f5f5f5" }, { name:"Black", hex:"#1a1a1a" }, { name:"Gray", hex:"#9ca3af" },
  { name:"Red", hex:"#ef4444" }, { name:"Blue", hex:"#3b82f6" }, { name:"Green", hex:"#22c55e" },
  { name:"Yellow", hex:"#eab308" }, { name:"Orange", hex:"#f97316" },
  { name:"Clear", hex:"#dbeafe", border:true },
  { name:"Any", hex:"linear-gradient(135deg,#f97316,#3b82f6,#22c55e)" }
];

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmtH(h) { var hr=Math.floor(h),mn=Math.round((h-hr)*60); if(hr===0)return mn+"m"; if(mn===0)return hr+"h"; return hr+"h "+mn+"m"; }
function fmtPlain(h) { if(h<0.5)return"less than 30 min"; if(h<1)return"about 30-60 min"; if(h<2)return"about "+Math.round(h)+" hour"; if(h<5)return"about "+Math.round(h)+" hours"; if(h<12)return"most of a day"; return"multiple days"; }
function fmtAUD(n) { return "$"+n.toFixed(2); }
function fmtMeters(m) { if(m<1000)return m.toFixed(0)+"m"; return(m/1000).toFixed(2)+"km"; }
function hexIsLight(hex) { var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return(r*299+g*587+b*114)/1000>160; }
function validHex(h) { return /^#[0-9a-fA-F]{6}$/.test(h); }
function estWeight(stats,material,qty) { if(!stats)return 0; return stats.volume*(DENSITIES[material]||1.24)*0.35*qty; }
function estCost(g,price) { return g*(price/SPOOL_G); }
function getRem(f) { return Math.max(0,(f.spoolsOwned||0)*SPOOL_G-(f.usedG||0)); }
function getStockStatus(f) { var r=getRem(f); if(!f.enabled)return"disabled"; if(r<=CRIT_G)return"critical"; if(r<=LOW_G)return"low"; return"ok"; }
var STATUS_STYLE = { ok:{color:"#22c55e",bg:"rgba(34,197,94,0.1)",label:"In Stock"}, low:{color:"#f59e0b",bg:"rgba(245,158,11,0.1)",label:"Low"}, critical:{color:"#ef4444",bg:"rgba(239,68,68,0.1)",label:"Critical"}, disabled:{color:"#4b5563",bg:"rgba(75,85,99,0.1)",label:"Disabled"} };

// Estimated ready date based on queue position
function estimateReadyDate(requests, newReq) {
  var queuedHours = 0;
  requests.forEach(function(r) {
    if (r.status === "Queued" || r.status === "Printing") {
      var h = r.stlStats ? r.stlStats.estimatedHours * r.quantity * 0.85 : 2;
      queuedHours += h;
    }
  });
  var myHours = newReq.stlStats ? newReq.stlStats.estimatedHours * newReq.quantity * 0.85 : 2;
  var totalMs = (queuedHours + myHours) * 3600000;
  var readyDate = new Date(Date.now() + totalMs);
  // Skip weekends
  while (readyDate.getDay() === 0 || readyDate.getDay() === 6) {
    readyDate.setDate(readyDate.getDate() + 1);
  }
  return readyDate;
}

function formatReadyDate(d) {
  var today = new Date();
  var diff = Math.ceil((d - today) / 86400000);
  var day = d.toLocaleDateString("en-AU", { weekday:"long", day:"numeric", month:"long" });
  if (diff <= 1) return "Today — " + day;
  if (diff === 2) return "Tomorrow — " + day;
  return day;
}

// Build volume check
function checkBuildVolume(dims) {
  var warnings = [];
  if (dims.x > BUILD_VOL.x) warnings.push("Width " + dims.x.toFixed(0) + "mm exceeds printer limit of " + BUILD_VOL.x + "mm");
  if (dims.y > BUILD_VOL.y) warnings.push("Depth " + dims.y.toFixed(0) + "mm exceeds printer limit of " + BUILD_VOL.y + "mm");
  if (dims.z > BUILD_VOL.z) warnings.push("Height " + dims.z.toFixed(0) + "mm exceeds printer limit of " + BUILD_VOL.z + "mm");
  return warnings;
}

// QR code generator (pure JS, no deps)
function generateQR(text) {
  // Simple URL-safe QR data URL using a free API — fallback to text display
  return "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(text) + "&bgcolor=0d1220&color=f97316&format=png";
}

// ICS calendar file generator
function generateICS(req, readyDate) {
  var start = readyDate.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  var end = new Date(readyDate.getTime()+3600000).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  var ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PrintLab//MACC//EN",
    "BEGIN:VEVENT",
    "DTSTART:" + start,
    "DTEND:" + end,
    "SUMMARY:Collect 3D Print - " + req.projectName,
    "DESCRIPTION:Your 3D print is ready!\\n\\nProject: " + req.projectName + "\\nFile: " + req.fileName + "\\nQty: x" + req.quantity,
    "LOCATION:Print Lab, MACC",
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
  var blob = new Blob([ics], { type:"text/calendar" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "print-pickup-" + req.id + ".ics"; a.click();
  setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
}

// ─── Email helpers ─────────────────────────────────────────────────────────────
function sendConfirmEmail(req, readyDate) {
  var readyStr = readyDate ? formatReadyDate(readyDate) : "TBC";
  var body = "Hi " + req.teacherName + ",\n\nYour 3D print request has been received! \u2705\n\n"
    + "Project: " + req.projectName + "\nFile: " + req.fileName + "\nMaterial: " + req.material + " (" + req.color + ")\nQty: x" + req.quantity + "\n"
    + "\nEstimated ready: " + readyStr
    + "\n\nYou'll get another email when printing starts and when it's ready to collect.\n\nThanks,\nPrint Lab, MACC";
  window.open("mailto:" + req.email + "?subject=" + encodeURIComponent("Print Request Received - " + req.projectName) + "&body=" + encodeURIComponent(body));
}
function sendStartEmail(req, admin, note) {
  var th = req.stlStats ? req.stlStats.estimatedHours * req.quantity * 0.85 : null;
  var eta = th ? new Date(Date.now()+th*3600000).toLocaleString([],{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "TBC";
  var adminName = admin && admin.name ? admin.name : "Print Lab";
  var noteLine = note ? "\n\nNote from Print Lab: " + note : "";
  var body = "Hi " + req.teacherName + ",\n\nYour 3D print has started! \uD83D\uDDA8\uFE0F\n\n"
    + "Project: " + req.projectName + "\nMaterial: " + req.material + " - " + req.color + "\nQty: x" + req.quantity + "\nEst. Ready: " + eta
    + noteLine + "\n\nYou'll be notified when it's ready to collect.\n\nThanks,\n" + adminName + ", Print Lab";
  window.open("mailto:" + req.email + "?subject=" + encodeURIComponent("Your Print Has Started - " + req.projectName) + "&body=" + encodeURIComponent(body));
}
function sendReadyEmail(req, admin, note) {
  var adminName = admin && admin.name ? admin.name : "Print Lab";
  var noteLine = note ? "\n\nNote: " + note : "";
  var body = "Hi " + req.teacherName + ",\n\nYour 3D print is ready for pickup! \uD83C\uDF89\n\n"
    + "Project: " + req.projectName + "\nQty: x" + req.quantity + " - " + req.material + " (" + req.color + ")"
    + noteLine + "\n\nPlease collect from the Print Lab at your convenience.\n\nThanks,\n" + adminName + ", Print Lab";
  window.open("mailto:" + req.email + "?subject=" + encodeURIComponent("Ready for Pickup - " + req.projectName) + "&body=" + encodeURIComponent(body));
}
function sendShoppingEmail(items, admin) {
  var adminName = admin && admin.name ? admin.name : "Print Lab";
  var lines = items.map(function(i) { return "- " + i.type + " " + i.color + ": order " + i.suggestSpools + " spool(s) (~" + fmtAUD(i.suggestSpools*i.price) + ")"; }).join("\n");
  var total = items.reduce(function(a,i) { return a+i.suggestSpools*i.price; }, 0);
  var body = "Hi,\n\nThe Print Lab needs the following filament from Bambu Lab Australia:\n\n" + lines + "\n\nTotal: ~" + fmtAUD(total) + " AUD\nShop: https://au.store.bambulab.com/collections/filament\n\nThanks,\n" + adminName;
  window.open("mailto:?subject=" + encodeURIComponent("Filament Restock - Print Lab MACC") + "&body=" + encodeURIComponent(body));
}

// ─── STL Parser ───────────────────────────────────────────────────────────────
function parseSTL(buffer) {
  var view = new DataView(buffer);
  var verts = [];
  var pc = view.getUint32(80, true);
  var isBin = buffer.byteLength === 80+4+pc*50 && pc>0;
  if (isBin) {
    for (var i=0;i<pc;i++) { var b=84+i*50+12; for (var v=0;v<3;v++) { var p=b+v*12; verts.push(view.getFloat32(p,true),view.getFloat32(p+4,true),view.getFloat32(p+8,true)); } }
  } else {
    var re=/vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g; var m; var txt=new TextDecoder().decode(buffer);
    while((m=re.exec(txt))!==null) verts.push(parseFloat(m[1]),parseFloat(m[2]),parseFloat(m[3]));
  }
  if (!verts.length) return null;
  var mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity,mnZ=Infinity,mxZ=-Infinity;
  for (var j=0;j<verts.length;j+=3) { var x=verts[j],y=verts[j+1],z=verts[j+2]; if(x<mnX)mnX=x; if(x>mxX)mxX=x; if(y<mnY)mnY=y; if(y>mxY)mxY=y; if(z<mnZ)mnZ=z; if(z>mxZ)mxZ=z; }
  var sx=mxX-mnX,sy=mxY-mnY,sz=mxZ-mnZ;
  var sv=0;
  for (var k=0;k<verts.length;k+=9) { var x1=verts[k],y1=verts[k+1],z1=verts[k+2],x2=verts[k+3],y2=verts[k+4],z2=verts[k+5],x3=verts[k+6],y3=verts[k+7],z3=verts[k+8]; sv+=(x1*(y2*z3-y3*z2)+x2*(y3*z1-y1*z3)+x3*(y1*z2-y2*z1))/6; }
  var vol=Math.abs(sv)/1000;
  var layers=sz/0.2,avgCS=Math.abs(sv)>0?Math.abs(sv)/Math.max(sz,1):sx*sy*0.3;
  var hrs=Math.max(0.25,(layers*(2*Math.PI*Math.sqrt(avgCS/Math.PI)*2+avgCS*0.2/0.4)/50)/3600);
  return { rawVertices:verts, triangles:verts.length/9, volume:vol, dimensions:{x:sx,y:sy,z:sz}, estimatedHours:hrs };
}

function getSzComp(d) {
  var m=Math.max(d.x,d.y,d.z);
  if(m<15)return{e:"🪙",l:"Tiny",s:"About the size of a coin"};
  if(m<30)return{e:"🎲",l:"Small",s:"About the size of a dice"};
  if(m<65)return{e:"⚾",l:"Medium",s:"About the size of a golf ball"};
  if(m<120)return{e:"🍎",l:"Large",s:"About the size of an apple"};
  if(m<200)return{e:"☕",l:"XL",s:"About the size of a coffee mug"};
  return{e:"🏀",l:"Huge",s:"May need splitting"};
}
function getCx(t) {
  if(t<5000)return{l:"Simple",c:"#22c55e",s:"★",warn:false};
  if(t<50000)return{l:"Standard",c:"#f59e0b",s:"★★",warn:false};
  if(t<500000)return{l:"Detailed",c:"#f97316",s:"★★★",warn:false};
  return{l:"Very Complex",c:"#ef4444",s:"★★★★",warn:true};
}

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useWidth() {
  var s=useState(typeof window!=="undefined"?window.innerWidth:1024); var w=s[0],setW=s[1];
  useEffect(function(){ function h(){setW(window.innerWidth);} window.addEventListener("resize",h); return function(){window.removeEventListener("resize",h);}; },[]);
  return w;
}

// ─── Shared styles ────────────────────────────────────────────────────────────
var baseInput = { width:"100%", background:"#050810", border:"1px solid #111827", borderRadius:8, padding:"10px 13px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none", transition:"border-color 0.15s" };
var smallInput = { width:"100%", background:"#050810", border:"1px solid #1a2035", borderRadius:7, padding:"8px 11px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none" };
var selectStyle = { width:"100%", background:"#050810", border:"1px solid #111827", borderRadius:8, padding:"10px 13px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none", cursor:"pointer", colorScheme:"dark" };

// ─── UI Components ────────────────────────────────────────────────────────────
function Lbl({ children, color }) { return <div style={{ fontSize:9, color:color||"#374151", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6 }}>{children}</div>; }
function Card({ title, children, accent, action }) {
  var bc=accent?"rgba(249,115,22,0.25)":"#111827";
  return <div style={{ background:"#0d1220", border:"1px solid "+bc, borderRadius:12, overflow:"hidden" }}>
    <div style={{ padding:"11px 15px", borderBottom:"1px solid "+(accent?"rgba(249,115,22,0.15)":"#111827"), fontSize:11, color:accent?"#f97316":"#6b7280", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span>{title}</span>{action}
    </div>
    <div style={{ padding:16, display:"flex", flexDirection:"column", gap:13 }}>{children}</div>
  </div>;
}
function StatCard({ emoji, value, label, color }) { return <div style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:12, padding:16, textAlign:"center" }}><div style={{ fontSize:28, marginBottom:8 }}>{emoji}</div><div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:22, color:color||"#e2e8f0", marginBottom:2 }}>{value}</div><div style={{ fontSize:11, color:"#6b7280" }}>{label}</div></div>; }
function InfoTile({ e, l, v, s, c }) { return <div style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:10, padding:12, textAlign:"center" }}><div style={{ fontSize:22, marginBottom:4 }}>{e}</div><div style={{ fontSize:9, color:"#374151", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:2 }}>{l}</div><div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, color:c||"#e2e8f0" }}>{v}</div><div style={{ fontSize:9, color:"#374151", marginTop:3, lineHeight:1.5 }}>{s}</div></div>; }
function Btn({ onClick, color, bg, border, children, disabled, style }) {
  var bgC=disabled?"#0a0f1a":(bg||"linear-gradient(135deg,#f97316,#c2410c)");
  var txC=disabled?"#1f2937":(color||"#fff");
  var bd=disabled?"1px solid #111827":(border||"none");
  return <button onClick={disabled?undefined:onClick} disabled={!!disabled} className={disabled?"":"bh"} style={Object.assign({ background:bgC, color:txC, border:bd, borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:disabled?"not-allowed":"pointer", letterSpacing:"0.08em", textTransform:"uppercase", width:"100%", boxShadow:disabled?"none":"0 0 18px rgba(249,115,22,0.2)" },style||{})}>{children}</button>;
}
function NavBtns({ onBack, onNext, disabled, label }) {
  return <div style={{ display:"flex", gap:10, marginTop:4 }}>
    {onBack&&<button onClick={onBack} style={{ flex:"0 0 auto", background:"transparent", color:"#4b5563", border:"1px solid #111827", borderRadius:8, padding:"12px 22px", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>← Back</button>}
    <button onClick={disabled?undefined:onNext} disabled={!!disabled} className={disabled?"":"bh"} style={{ flex:1, background:disabled?"#0a0f1a":"linear-gradient(135deg,#f97316,#c2410c)", color:disabled?"#1f2937":"#fff", border:"none", borderRadius:8, padding:"13px 0", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:disabled?"not-allowed":"pointer", letterSpacing:"0.1em", textTransform:"uppercase" }}>
      {label||"Continue →"}
    </button>
  </div>;
}
function StepBar({ step, steps }) {
  return <div style={{ display:"flex", alignItems:"center", marginBottom:26 }}>
    {steps.map(function(s,i) {
      var done=i<step,active=i===step;
      return <div key={i} style={{ display:"flex", alignItems:"center", flex:i<steps.length-1?1:"none" }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
          <div style={{ width:30, height:30, borderRadius:"50%", border:"2px solid "+(active||done?"#f97316":"#111827"), background:done?"#f97316":active?"rgba(249,115,22,0.12)":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:(active||done)?"#f97316":"#1f2937", fontWeight:600 }}>{done?"✓":i+1}</div>
          <div style={{ fontSize:8, color:active?"#f97316":done?"#6b7280":"#1f2937", letterSpacing:"0.1em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{s}</div>
        </div>
        {i<steps.length-1&&<div style={{ flex:1, height:2, background:done?"#f97316":"#111827", margin:"0 6px", marginBottom:18 }}/>}
      </div>;
    })}
  </div>;
}

// ─── 3D Preview ───────────────────────────────────────────────────────────────
function STLPreview({ rawVertices }) {
  var ref=useRef(null);
  useEffect(function() {
    if (!rawVertices||!rawVertices.length||!ref.current) return;
    var el=ref.current,w=el.clientWidth||340,h=240;
    var scene=new THREE.Scene(); scene.background=new THREE.Color(0x080d16);
    var cam=new THREE.PerspectiveCamera(42,w/h,.001,1e7);
    var rend=new THREE.WebGLRenderer({antialias:true}); rend.setSize(w,h); rend.setPixelRatio(Math.min(window.devicePixelRatio,2)); el.appendChild(rend.domElement);
    var geo=new THREE.BufferGeometry(); geo.setAttribute("position",new THREE.Float32BufferAttribute(rawVertices,3)); geo.computeVertexNormals(); geo.computeBoundingBox();
    var ctr=new THREE.Vector3(),sz=new THREE.Vector3(); geo.boundingBox.getCenter(ctr); geo.boundingBox.getSize(sz); var md=Math.max(sz.x,sz.y,sz.z)||1;
    var mat=new THREE.MeshPhongMaterial({color:0xf97316,specular:0x441100,shininess:80,side:THREE.DoubleSide});
    var mesh=new THREE.Mesh(geo,mat); mesh.position.sub(ctr);
    var pivot=new THREE.Group(); pivot.add(mesh); pivot.rotation.x=0.25; scene.add(pivot);
    var plate=new THREE.Mesh(new THREE.PlaneGeometry(md*3,md*3,16,16),new THREE.MeshBasicMaterial({color:0x0d1220,side:THREE.DoubleSide}));
    plate.rotation.x=-Math.PI/2; plate.position.y=-sz.y/2; scene.add(plate);
    scene.add(new THREE.GridHelper(md*3,14,0x1a2540,0x1a2540));
    scene.add(new THREE.AmbientLight(0xffffff,.4));
    var d1=new THREE.DirectionalLight(0xffd090,1); d1.position.set(1.5,3,2); scene.add(d1);
    var d2=new THREE.DirectionalLight(0x4466ff,.35); d2.position.set(-2,-1,-2); scene.add(d2);
    cam.position.set(0,md*.5,md*2.1); cam.lookAt(0,0,0);
    var drag=false,prev={x:0,y:0};
    function onD(e){drag=true;prev={x:e.clientX,y:e.clientY};rend.domElement.style.cursor="grabbing";}
    function onM(e){if(!drag)return;pivot.rotation.y+=(e.clientX-prev.x)*.013;pivot.rotation.x=Math.max(-1.2,Math.min(1.2,pivot.rotation.x+(e.clientY-prev.y)*.013));prev={x:e.clientX,y:e.clientY};}
    function onU(){drag=false;rend.domElement.style.cursor="grab";}
    rend.domElement.style.cursor="grab"; rend.domElement.addEventListener("mousedown",onD); window.addEventListener("mousemove",onM); window.addEventListener("mouseup",onU);
    var aid; function loop(){aid=requestAnimationFrame(loop);if(!drag)pivot.rotation.y+=.004;rend.render(scene,cam);} loop();
    return function(){cancelAnimationFrame(aid);rend.domElement.removeEventListener("mousedown",onD);window.removeEventListener("mousemove",onM);window.removeEventListener("mouseup",onU);geo.dispose();mat.dispose();rend.dispose();if(el.contains(rend.domElement))el.removeChild(rend.domElement);};
  },[rawVertices]);
  return <div style={{ position:"relative", width:"100%", height:240, borderRadius:12, overflow:"hidden", background:"#080d16" }}>
    <div ref={ref} style={{ width:"100%", height:"100%" }}/>
    <div style={{ position:"absolute", bottom:8, left:12, fontSize:9, color:"#2d3748", pointerEvents:"none" }}>DRAG TO ROTATE</div>
    <div style={{ position:"absolute", top:8, right:10, display:"flex", alignItems:"center", gap:5, pointerEvents:"none" }}>
      <div style={{ width:5, height:5, borderRadius:"50%", background:"#f97316", boxShadow:"0 0 6px #f97316" }}/>
      <span style={{ fontSize:9, color:"#f97316" }}>3D PREVIEW</span>
    </div>
  </div>;
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function Countdown({ startedAt, estimatedHours, quantity }) {
  var totalMs=estimatedHours*quantity*0.85*3600000;
  var sr=useState(0); var rem=sr[0],setRem=sr[1];
  useEffect(function(){function tick(){setRem(Math.max(0,new Date(startedAt).getTime()+totalMs-Date.now()));}tick();var id=setInterval(tick,1000);return function(){clearInterval(id);};},[startedAt,totalMs]);
  var done=rem===0,prog=done?1:Math.min(1,1-rem/totalMs);
  var h=Math.floor(rem/3600000),mins=Math.floor((rem%3600000)/60000),s=Math.floor((rem%60000)/1000);
  var C=2*Math.PI*40;
  var hS=h<10?"0"+h:""+h,mS=mins<10?"0"+mins:""+mins,sS=s<10?"0"+s:""+s;
  var etaTime=new Date(new Date(startedAt).getTime()+totalMs).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  return <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:"8px 0" }}>
    <div style={{ position:"relative", width:100, height:100 }}>
      <svg width="100" height="100" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="50" cy="50" r="40" fill="none" stroke="#111827" strokeWidth="6"/>
        <circle cx="50" cy="50" r="40" fill="none" stroke={done?"#22c55e":"#3b82f6"} strokeWidth="6" strokeDasharray={C} strokeDashoffset={C*(1-prog)} strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s linear" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
        {done?<span style={{ fontSize:22 }}>✅</span>:<div style={{ textAlign:"center" }}><div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#3b82f6", fontWeight:500 }}>{hS}:{mS}:{sS}</div><div style={{ fontSize:7, color:"#1f2937", marginTop:1 }}>REMAINING</div></div>}
      </div>
    </div>
    <div style={{ textAlign:"center" }}><div style={{ fontSize:12, color:done?"#22c55e":"#3b82f6", fontWeight:500 }}>{done?"Print Complete!":"Printing..."}</div>{!done&&<div style={{ fontSize:9, color:"#374151", marginTop:2 }}>ETA {etaTime} — {Math.round(prog*100)}% elapsed</div>}</div>
  </div>;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function Confetti() {
  var pieces=[];
  var cc=["#f97316","#3b82f6","#22c55e","#f59e0b","#ec4899","#a855f7"];
  for(var i=0;i<50;i++) pieces.push({id:i,x:Math.random()*100,color:cc[i%6],delay:Math.random()*1.2,size:5+Math.random()*9,rot:Math.random()*360,round:i%3===2});
  return <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9999, overflow:"hidden" }}>
    {pieces.map(function(p){return <div key={p.id} style={{ position:"absolute", left:p.x+"%", top:"-20px", width:p.size, height:p.size, background:p.color, borderRadius:p.round?"50%":"2px", animation:"cf "+(1.8+Math.random()*0.8)+"s "+p.delay+"s ease-in forwards", transform:"rotate("+p.rot+"deg)" }}/>;  })}
  </div>;
}

// ─── Admin Auth Components ────────────────────────────────────────────────────
function AdminLogin({ onLogin }) {
  var se=useState(""); var email=se[0],setEmail=se[1];
  var sp=useState(""); var pw=sp[0],setPw=sp[1];
  var serr=useState(""); var err=serr[0],setErr=serr[1];
  var sb=useState(false); var busy=sb[0],setBusy=sb[1];
  var sshow=useState(false); var show=sshow[0],setShow=sshow[1];
  async function go(){setBusy(true);setErr("");var admins=await loadAdmins();var found=null;for(var i=0;i<admins.length;i++){if(admins[i].email.toLowerCase()===email.toLowerCase().trim()){found=admins[i];break;}}if(!found||found.password!==pw){setErr("Incorrect email or password.");setBusy(false);return;}onLogin(found);setBusy(false);}
  return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"55vh" }}>
    <div style={{ width:"100%", maxWidth:400, background:"#0d1220", border:"1px solid #111827", borderRadius:16, overflow:"hidden" }}>
      <div style={{ background:"linear-gradient(135deg,#f97316,#c2410c)", padding:24, textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:8 }}>🔒</div>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:18, color:"#fff" }}>Admin Sign In</div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", marginTop:3 }}>Print Lab staff only</div>
      </div>
      <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
        <div><Lbl>Email</Lbl><input value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="you@macc.nsw.edu.au" style={baseInput} onKeyDown={function(e){if(e.key==="Enter")go();}}/></div>
        <div><Lbl>Password</Lbl>
          <div style={{ position:"relative" }}>
            <input type={show?"text":"password"} value={pw} onChange={function(e){setPw(e.target.value);}} style={Object.assign({},baseInput,{paddingRight:40})} onKeyDown={function(e){if(e.key==="Enter")go();}}/>
            <button onClick={function(){setShow(function(p){return !p;});}} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:14 }}>{show?"🙈":"👁"}</button>
          </div>
        </div>
        {err&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#ef4444" }}>{err}</div>}
        <button onClick={go} disabled={!email||!pw||busy} style={{ background:email&&pw?"linear-gradient(135deg,#f97316,#c2410c)":"#0a0f1a", color:email&&pw?"#fff":"#1f2937", border:"none", borderRadius:8, padding:"13px 0", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:email&&pw?"pointer":"not-allowed", letterSpacing:"0.1em", textTransform:"uppercase" }}>{busy?"Signing in...":"Sign In →"}</button>
      </div>
    </div>
  </div>;
}

function ChangePasswordModal({ admin, forced, onDone, onCancel }) {
  var sc=useState(""); var cur=sc[0],setCur=sc[1];
  var sn=useState(""); var next=sn[0],setNext=sn[1];
  var scf=useState(""); var conf=scf[0],setConf=scf[1];
  var se=useState(""); var err=se[0],setErr=se[1];
  var sok=useState(false); var ok=sok[0],setOk=sok[1];
  var strength=next.length===0?0:next.length<8?1:(/[A-Z]/.test(next)&&/[0-9]/.test(next)&&/[^A-Za-z0-9]/.test(next))?3:2;
  var strC=["#1f2937","#ef4444","#f59e0b","#22c55e"][strength];
  var strW=["0%","33%","66%","100%"][strength];
  var strL=["","Too short","Could be stronger","Strong!"][strength];
  var valid=next.length>=8&&next===conf&&(forced||cur);
  async function go(){setErr("");if(!forced&&cur!==admin.password){setErr("Current password incorrect.");return;}if(next!==conf){setErr("Passwords don't match.");return;}var admins=await loadAdmins();await saveAdmins(admins.map(function(a){return a.email===admin.email?Object.assign({},a,{password:next,mustReset:false}):a;}));setOk(true);setTimeout(function(){onDone(Object.assign({},admin,{password:next,mustReset:false}));},1500);}
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:420, background:"#0d1220", border:"1px solid #111827", borderRadius:16, overflow:"hidden" }}>
      <div style={{ borderBottom:"1px solid #111827", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div><div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15 }}>🔑 {forced?"Set Your Password":"Change Password"}</div>{forced&&<div style={{ fontSize:11, color:"#f59e0b", marginTop:3 }}>Set a personal password to continue</div>}</div>
        {!forced&&<button onClick={onCancel} style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:18 }}>×</button>}
      </div>
      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:13 }}>
        {ok?<div style={{ textAlign:"center", padding:"20px 0" }}><div style={{ fontSize:44, marginBottom:10 }}>✅</div><div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, color:"#22c55e" }}>Password updated!</div></div>:<>
          {!forced&&<div><Lbl>Current password</Lbl><input type="password" value={cur} onChange={function(e){setCur(e.target.value);}} style={baseInput}/></div>}
          <div><Lbl>New password</Lbl><input type="password" value={next} onChange={function(e){setNext(e.target.value);}} style={baseInput} placeholder="Min 8 characters"/>
            {next&&<div style={{ marginTop:5, display:"flex", alignItems:"center", gap:8 }}><div style={{ flex:1, height:3, background:"#111827", borderRadius:2 }}><div style={{ width:strW, height:"100%", background:strC, borderRadius:2, transition:"all .3s" }}/></div><span style={{ fontSize:9, color:strC }}>{strL}</span></div>}
          </div>
          <div><Lbl>Confirm password</Lbl><input type="password" value={conf} onChange={function(e){setConf(e.target.value);}} style={baseInput}/>{conf&&next!==conf&&<div style={{ fontSize:11, color:"#ef4444", marginTop:4 }}>Passwords don't match</div>}</div>
          {err&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#ef4444" }}>{err}</div>}
          <button onClick={go} disabled={!valid} style={{ background:valid?"linear-gradient(135deg,#f97316,#c2410c)":"#0a0f1a", color:valid?"#fff":"#1f2937", border:"none", borderRadius:8, padding:"13px 0", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:valid?"pointer":"not-allowed", letterSpacing:"0.1em", textTransform:"uppercase" }}>Update Password →</button>
        </>}
      </div>
    </div>
  </div>;
}

function ManageAdmins({ currentAdmin, onClose }) {
  var sa=useState([]); var admins=sa[0],setAdmins=sa[1];
  var sn=useState({email:"",name:"",role:"Admin"}); var newA=sn[0],setNewA=sn[1];
  var ss=useState(false); var showAdd=ss[0],setShowAdd=ss[1];
  var sm=useState(""); var msg=sm[0],setMsg=sm[1];
  useEffect(function(){loadAdmins().then(setAdmins);},[]);
  async function addAdmin(){var pw="Print#"+Math.floor(1000+Math.random()*9000);var updated=admins.concat([Object.assign({},newA,{email:newA.email.trim(),name:newA.name.trim(),password:pw,mustReset:true})]);await saveAdmins(updated);setAdmins(updated);setMsg("Added "+newA.name+". Temp password: "+pw);setNewA({email:"",name:"",role:"Admin"});setShowAdd(false);}
  async function resetPw(email){var pw="Print#"+Math.floor(1000+Math.random()*9000);var updated=admins.map(function(a){return a.email===email?Object.assign({},a,{password:pw,mustReset:true}):a;});await saveAdmins(updated);setAdmins(updated);setMsg("Reset for "+email+". New temp: "+pw);}
  async function remove(email){if(email===currentAdmin.email){setMsg("Cannot remove your own account.");return;}var updated=admins.filter(function(a){return a.email!==email;});await saveAdmins(updated);setAdmins(updated);}
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:560, background:"#0d1220", border:"1px solid #111827", borderRadius:16, overflow:"hidden", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
      <div style={{ borderBottom:"1px solid #111827", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15 }}>👥 Manage Admin Accounts</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:18 }}>×</button>
      </div>
      <div style={{ padding:20, overflowY:"auto", display:"flex", flexDirection:"column", gap:10 }}>
        {msg&&<div style={{ background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#22c55e" }}>{msg}</div>}
        {admins.map(function(a){
          var isYou=a.email===currentAdmin.email;
          return <div key={a.email} style={{ background:"#080d16", border:"1px solid #111827", borderRadius:10, padding:"12px 15px", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:"linear-gradient(135deg,#f97316,#c2410c)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:15, color:"#fff", flexShrink:0 }}>{a.name.charAt(0)}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{a.name}</div>
                {isYou&&<span style={{ fontSize:8, background:"rgba(249,115,22,0.15)", color:"#f97316", borderRadius:3, padding:"2px 6px" }}>YOU</span>}
                {a.mustReset&&<span style={{ fontSize:8, background:"rgba(245,158,11,0.15)", color:"#f59e0b", borderRadius:3, padding:"2px 6px" }}>TEMP PW</span>}
              </div>
              <div style={{ fontSize:10, color:"#374151" }}>{a.email} — {a.role}</div>
            </div>
            <div style={{ display:"flex", gap:5 }}>
              <button onClick={function(){resetPw(a.email);}} style={{ background:"transparent", color:"#f59e0b", border:"1px solid rgba(245,158,11,0.3)", borderRadius:5, padding:"5px 10px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>Reset PW</button>
              {!isYou&&<button onClick={function(){remove(a.email);}} style={{ background:"transparent", color:"#ef4444", border:"1px solid rgba(239,68,68,0.25)", borderRadius:5, padding:"5px 10px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>Remove</button>}
            </div>
          </div>;
        })}
        {showAdd?<div style={{ background:"rgba(249,115,22,0.05)", border:"1px solid rgba(249,115,22,0.15)", borderRadius:10, padding:14, display:"flex", flexDirection:"column", gap:10 }}>
          <Lbl color="#f97316">New admin account</Lbl>
          <input value={newA.name} onChange={function(e){setNewA(function(n){return Object.assign({},n,{name:e.target.value});});}} placeholder="Full name" style={baseInput}/>
          <input value={newA.email} onChange={function(e){setNewA(function(n){return Object.assign({},n,{email:e.target.value});});}} placeholder="Email" style={baseInput}/>
          <input value={newA.role} onChange={function(e){setNewA(function(n){return Object.assign({},n,{role:e.target.value});});}} placeholder="Role" style={baseInput}/>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={addAdmin} disabled={!newA.email||!newA.name} style={{ flex:1, background:newA.email&&newA.name?"#f97316":"#0a0f1a", color:newA.email&&newA.name?"#fff":"#1f2937", border:"none", borderRadius:7, padding:"10px 0", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", textTransform:"uppercase" }}>Add Account</button>
            <button onClick={function(){setShowAdd(false);}} style={{ flex:1, background:"transparent", color:"#4b5563", border:"1px solid #111827", borderRadius:7, padding:"10px 0", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>:<button onClick={function(){setShowAdd(true);}} style={{ background:"transparent", color:"#f97316", border:"2px dashed rgba(249,115,22,0.3)", borderRadius:10, padding:"12px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>+ Add New Admin</button>}
      </div>
    </div>
  </div>;
}

// ─── Printer Settings Modal ───────────────────────────────────────────────────
function PrinterSettings({ onClose }) {
  var ss=useState(null); var settings=ss[0],setSettings=ss[1];
  var st=useState(null); var printerStatus=st[0],setPrinterStatus=st[1];
  var sl=useState(false); var testing=sl[0],setTesting=sl[1];
  useEffect(function(){loadSettings().then(setSettings);},[]);
  async function save(){await saveSettings(settings);onClose();}
  async function testConnection(){
    if(!settings||!settings.printerIp){return;}
    setTesting(true);setPrinterStatus(null);
    try {
      var r=await fetch("http://"+settings.printerIp+"/api/print",{method:"GET",headers:{"X-Api-Key":settings.printerCode},signal:AbortSignal.timeout(3000)});
      if(r.ok){var d=await r.json();setPrinterStatus({ok:true,msg:"Connected! "+JSON.stringify(d).slice(0,60)});}
      else{setPrinterStatus({ok:false,msg:"Connected but got error "+r.status});}
    } catch(e){setPrinterStatus({ok:false,msg:"Could not connect. Check IP and access code. ("+e.message+")"});}
    setTesting(false);
  }
  if(!settings)return null;
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:520, background:"#0d1220", border:"1px solid #111827", borderRadius:16, overflow:"hidden" }}>
      <div style={{ borderBottom:"1px solid #111827", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15 }}>⚙️ Printer Settings</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:18 }}>×</button>
      </div>
      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:14 }}>
        <div style={{ background:"rgba(59,130,246,0.07)", border:"1px solid rgba(59,130,246,0.2)", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#60a5fa", lineHeight:1.7 }}>
          To connect your Bambu Lab printer, enable LAN Mode in the printer settings. Find your IP address and access code in the printer's network menu.
        </div>
        <div><Lbl>Printer Model</Lbl>
          <select value={settings.printerModel||"Bambu X1C"} onChange={function(e){setSettings(function(s){return Object.assign({},s,{printerModel:e.target.value});});}} style={selectStyle}>
            {["Bambu X1C","Bambu P1S","Bambu P1P","Bambu A1","Bambu A1 Mini"].map(function(m){return <option key={m}>{m}</option>;})}
          </select>
        </div>
        <div><Lbl>Printer IP Address</Lbl><input value={settings.printerIp||""} onChange={function(e){setSettings(function(s){return Object.assign({},s,{printerIp:e.target.value});});}} placeholder="e.g. 192.168.1.42" style={baseInput}/></div>
        <div><Lbl>Access Code</Lbl><input value={settings.printerCode||""} onChange={function(e){setSettings(function(s){return Object.assign({},s,{printerCode:e.target.value});});}} placeholder="8-digit code from printer screen" style={baseInput}/></div>
        {printerStatus&&<div style={{ background:printerStatus.ok?"rgba(34,197,94,0.08)":"rgba(239,68,68,0.08)", border:"1px solid "+(printerStatus.ok?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)"), borderRadius:8, padding:"10px 12px", fontSize:11, color:printerStatus.ok?"#22c55e":"#ef4444" }}>{printerStatus.ok?"✅ ":"❌ "}{printerStatus.msg}</div>}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={testConnection} disabled={testing||!settings.printerIp} style={{ flex:1, background:"rgba(59,130,246,0.1)", color:"#3b82f6", border:"1px solid rgba(59,130,246,0.3)", borderRadius:8, padding:"10px 0", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:settings.printerIp?"pointer":"not-allowed", letterSpacing:"0.08em", textTransform:"uppercase" }}>{testing?"Testing...":"Test Connection"}</button>
          <button onClick={save} style={{ flex:2, background:"linear-gradient(135deg,#f97316,#c2410c)", color:"#fff", border:"none", borderRadius:8, padding:"10px 0", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Save Settings</button>
        </div>
      </div>
    </div>
  </div>;
}

// ─── Teacher Status Check Page ─────────────────────────────────────────────────
function TeacherStatus({ requests }) {
  var se=useState(""); var email=se[0],setEmail=se[1];
  var ss=useState(null); var searched=ss[0],setSearched=ss[1];
  function search(){var lc=email.toLowerCase().trim();setSearched(requests.filter(function(r){return r.email&&r.email.toLowerCase()===lc;}));}
  return <div>
    <div style={{ textAlign:"center", marginBottom:28 }}>
      <div style={{ fontSize:36, marginBottom:10 }}>📬</div>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, marginBottom:6 }}>Check Your Print Status</div>
      <div style={{ fontSize:13, color:"#4b5563" }}>Enter your school email to see all your print requests</div>
    </div>
    <div style={{ maxWidth:500, margin:"0 auto" }}>
      <div style={{ display:"flex", gap:8 }}>
        <input value={email} onChange={function(e){setEmail(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")search();}} placeholder="your.email@macc.nsw.edu.au" style={Object.assign({},baseInput,{flex:1})}/>
        <button onClick={search} disabled={!email} className="bh" style={{ background:"linear-gradient(135deg,#f97316,#c2410c)", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:email?"pointer":"not-allowed", letterSpacing:"0.08em", whiteSpace:"nowrap" }}>Check Status</button>
      </div>
      {searched!==null&&<div style={{ marginTop:20 }}>
        {searched.length===0?<div style={{ textAlign:"center", padding:"32px 0", color:"#374151" }}><div style={{ fontSize:32, marginBottom:10 }}>🔍</div>No requests found for that email.</div>
        :<div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:12, color:"#6b7280", marginBottom:4 }}>Found {searched.length} request{searched.length!==1?"s":""} for {email}</div>
          {searched.map(function(req){
            var isPrinting=req.status==="Printing"&&req.printStartedAt&&req.stlStats;
            return <div key={req.id} style={{ background:"#0d1220", border:"1px solid "+(req.status==="Done"?"rgba(34,197,94,0.3)":req.status==="Printing"?"rgba(59,130,246,0.3)":"#111827"), borderRadius:12, overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #111827", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:14, color:"#e2e8f0", fontWeight:500 }}>{req.projectName}</div>
                  <div style={{ fontSize:10, color:"#374151", marginTop:2 }}>{new Date(req.submittedAt).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"})}</div>
                </div>
                <span style={{ background:SC[req.status]+"20", color:SC[req.status], border:"1px solid "+SC[req.status]+"40", borderRadius:4, padding:"4px 10px", fontSize:9, letterSpacing:"0.07em", textTransform:"uppercase" }}>{req.status}</span>
              </div>
              <div style={{ padding:"12px 16px" }}>
                {isPrinting&&<Countdown startedAt={req.printStartedAt} estimatedHours={req.stlStats.estimatedHours} quantity={req.quantity}/>}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:isPrinting?10:0 }}>
                  {[["Material",req.material+" ("+req.color+")"],["Quantity","x"+req.quantity],["File",req.fileName],["Dept.",req.department||"—"]].map(function(pair){
                    return <div key={pair[0]} style={{ background:"#080d16", borderRadius:6, padding:"7px 10px" }}>
                      <div style={{ fontSize:9, color:"#374151", marginBottom:2 }}>{pair[0]}</div>
                      <div style={{ fontSize:11, color:"#6b7280" }}>{pair[1]}</div>
                    </div>;
                  })}
                </div>
                {req.status==="Done"&&<div style={{ marginTop:10, background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#22c55e", textAlign:"center" }}>✅ Ready for pickup from the Print Lab!</div>}
              </div>
            </div>;
          })}
        </div>}
      </div>}
    </div>
  </div>;
}

// ─── Public Stats ─────────────────────────────────────────────────────────────
function PublicStats({ requests }) {
  var done=requests.filter(function(r){return r.status==="Done";});
  var totalFilG=done.reduce(function(a,r){return a+(r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity));},0);
  var totalHrs=done.reduce(function(a,r){return a+(r.stlStats?r.stlStats.estimatedHours*r.quantity*0.85:0);},0);
  var totalCost=done.reduce(function(a,r){return a+(r.estimatedCostAUD||0);},0);
  var totalPieces=done.reduce(function(a,r){return a+r.quantity;},0);
  var totalMeters=totalFilG*1/(Math.PI*Math.pow(0.0875,2)*10*1.24);
  var matC={};done.forEach(function(r){matC[r.material]=(matC[r.material]||0)+r.quantity;});
  var topMat=Object.entries(matC).sort(function(a,b){return b[1]-a[1];})[0];
  var deptC={};done.forEach(function(r){var d=r.department||"General";deptC[d]=(deptC[d]||0)+r.quantity;});
  var topDept=Object.entries(deptC).sort(function(a,b){return b[1]-a[1];})[0];
  var colC={};done.forEach(function(r){colC[r.color]=(colC[r.color]||0)+r.quantity;});
  var topCol=Object.entries(colC).sort(function(a,b){return b[1]-a[1];})[0];
  var mSub=totalMeters>878000?"Further than Sydney to Melbourne!":totalMeters>1149?"Longer than the Sydney Harbour Bridge!":totalMeters>65?"Taller than the Sydney Opera House!":"Keep printing — great things are happening!";
  var hSub=totalHrs>720?"Over a month of non-stop printing!":totalHrs>168?"Over a week of non-stop printing!":totalHrs>24?"More than a full day of printing!":"The printer has been busy!";
  var funFacts=[
    {emoji:"📏",fact:fmtMeters(totalMeters)+" of filament used",sub:mSub},
    {emoji:"⏱️",fact:fmtH(totalHrs)+" of total print time",sub:hSub},
    {emoji:"🏆",fact:(topDept?topDept[0]:"—")+" leads the way",sub:"Most active department this term"},
    {emoji:"🎨",fact:(topCol?topCol[0]:"—")+" is the fan favourite",sub:"Most requested colour"},
    {emoji:"🧱",fact:(topMat?topMat[0]:"—")+" is the go-to material",sub:"Most popular material choice"}
  ];
  return <div>
    <div style={{ textAlign:"center", marginBottom:28 }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900, letterSpacing:"-0.03em", marginBottom:6 }}>Print Lab Stats</div>
      <div style={{ fontSize:13, color:"#4b5563" }}>What we've made together this term</div>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:28 }}>
      <StatCard emoji="🖨️" value={""+done.length} label="Print Jobs Done" color="#f97316"/>
      <StatCard emoji="📦" value={""+totalPieces} label="Total Pieces" color="#3b82f6"/>
      <StatCard emoji="🧶" value={(totalFilG/1000).toFixed(2)+" kg"} label="Filament Used" color="#22c55e"/>
      <StatCard emoji="💰" value={fmtAUD(totalCost)} label="Est. Material Cost" color="#f59e0b"/>
    </div>
    <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, marginBottom:14 }}>Fun Facts</div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:28 }}>
      {funFacts.map(function(f,i){return <div key={i} style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:12, padding:16 }}><div style={{ fontSize:26, marginBottom:8 }}>{f.emoji}</div><div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14, color:"#e2e8f0", marginBottom:4, lineHeight:1.3 }}>{f.fact}</div><div style={{ fontSize:10, color:"#4b5563", lineHeight:1.6 }}>{f.sub}</div></div>;})}
    </div>
    {done.slice(0,5).length>0&&<div>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, marginBottom:14 }}>Recently Completed</div>
      <div style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
        {done.slice(0,5).map(function(r,i){return <div key={r.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"12px 16px", borderBottom:i<4?"1px solid #080d16":"none" }}>
          <div style={{ width:36, height:36, borderRadius:8, background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>✅</div>
          <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.projectName}</div><div style={{ fontSize:10, color:"#374151" }}>{r.teacherName}{r.department?" — "+r.department:""}</div></div>
          <div style={{ textAlign:"right", flexShrink:0 }}><div style={{ fontSize:11, color:"#f97316" }}>{r.material} — {r.color}</div><div style={{ fontSize:9, color:"#1f2937" }}>{new Date(r.submittedAt).toLocaleDateString("en-AU",{day:"numeric",month:"short"})}</div></div>
        </div>;})}
      </div>
    </div>}
    {done.length===0&&<div style={{ textAlign:"center", padding:"40px 0", color:"#1f2937" }}><div style={{ fontSize:44, marginBottom:12, opacity:0.15 }}>🖨️</div><div style={{ fontSize:14 }}>No completed prints yet</div></div>}
  </div>;
}

// ─── Monthly Report ───────────────────────────────────────────────────────────
function MonthlyReport({ requests }) {
  var sm=useState(new Date().getMonth()); var selMonth=sm[0],setSelMonth=sm[1];
  var sy=useState(new Date().getFullYear()); var selYear=sy[0],setSelYear=sy[1];
  var monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
  var filtered=requests.filter(function(r){var d=new Date(r.submittedAt);return d.getMonth()===selMonth&&d.getFullYear()===selYear;});
  var done=filtered.filter(function(r){return r.status==="Done";});
  var totalFilG=done.reduce(function(a,r){return a+(r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity));},0);
  var totalCost=done.reduce(function(a,r){return a+(r.estimatedCostAUD||0);},0);
  var byDept={};filtered.forEach(function(r){var d=r.department||"General";if(!byDept[d])byDept[d]={dept:d,jobs:0,cost:0,g:0};byDept[d].jobs++;byDept[d].cost+=(r.estimatedCostAUD||0);byDept[d].g+=(r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity));});
  var deptRows=Object.values(byDept).sort(function(a,b){return b.jobs-a.jobs;});
  function printReport(){window.print();}
  return <div>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800 }}>Monthly Usage Report</div>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <select value={selMonth} onChange={function(e){setSelMonth(parseInt(e.target.value));}} style={Object.assign({},selectStyle,{width:"auto",padding:"6px 12px",fontSize:11})}>
          {monthNames.map(function(m,i){return <option key={i} value={i}>{m}</option>;})}
        </select>
        <select value={selYear} onChange={function(e){setSelYear(parseInt(e.target.value));}} style={Object.assign({},selectStyle,{width:"auto",padding:"6px 12px",fontSize:11})}>
          {[2024,2025,2026,2027].map(function(y){return <option key={y}>{y}</option>;})}
        </select>
        <button onClick={printReport} className="bh" style={{ background:"rgba(249,115,22,0.1)", color:"#f97316", border:"1px solid rgba(249,115,22,0.3)", borderRadius:7, padding:"7px 14px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>🖨 Print</button>
      </div>
    </div>
    <div style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:12, padding:20, marginBottom:16 }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:15, fontWeight:800, marginBottom:3 }}>MACC Print Lab — {monthNames[selMonth]} {selYear}</div>
      <div style={{ fontSize:11, color:"#374151" }}>Generated {new Date().toLocaleDateString("en-AU",{day:"numeric",month:"long",year:"numeric"})}</div>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
      <StatCard emoji="📋" value={""+filtered.length} label="Total Requests" color="#4b5563"/>
      <StatCard emoji="✅" value={""+done.length} label="Completed" color="#22c55e"/>
      <StatCard emoji="🧶" value={(totalFilG/1000).toFixed(2)+" kg"} label="Filament Used" color="#f97316"/>
      <StatCard emoji="💰" value={fmtAUD(totalCost)} label="Material Cost" color="#f59e0b"/>
    </div>
    {deptRows.length>0&&<Card title="Usage by Department">
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr>{["Department","Jobs","Filament","Cost"].map(function(h){return <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:9, color:"#374151", letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:"1px solid #111827" }}>{h}</th>;})}</tr></thead>
        <tbody>{deptRows.map(function(d,i){return <tr key={d.dept} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
          <td style={{ padding:"10px", fontSize:12, color:"#e2e8f0", borderBottom:"1px solid #0d1220" }}>{d.dept}</td>
          <td style={{ padding:"10px", fontSize:12, color:"#6b7280", borderBottom:"1px solid #0d1220" }}>{d.jobs}</td>
          <td style={{ padding:"10px", fontSize:12, color:"#f97316", borderBottom:"1px solid #0d1220" }}>{d.g.toFixed(0)}g</td>
          <td style={{ padding:"10px", fontSize:12, color:"#f59e0b", borderBottom:"1px solid #0d1220" }}>{fmtAUD(d.cost)}</td>
        </tr>;})}
        </tbody>
      </table>
    </Card>}
    {filtered.length===0&&<div style={{ textAlign:"center", padding:"40px 0", color:"#1f2937" }}><div style={{ fontSize:36, opacity:0.15, marginBottom:10 }}>📊</div><div>No requests for {monthNames[selMonth]} {selYear}</div></div>}
  </div>;
}

// ─── Filament Inventory ───────────────────────────────────────────────────────
var BLANK_FIL={type:"",colorName:"",hex:"#f97316",material:"PLA",priceAUD:"24.99",spoolsOwned:"1"};
var MAT_TYPES=["PLA","PETG","ABS","TPU"];

function FilamentInventory({ requests, admin }) {
  var si=useState([]); var inv=si[0],setInv=si[1];
  var sf=useState("All"); var filter=sf[0],setFilter=sf[1];
  var sr=useState(null); var restockId=sr[0],setRestockId=sr[1];
  var srq=useState(1); var restockQty=srq[0],setRestockQty=srq[1];
  var sshf=useState(false); var showForm=sshf[0],setShowForm=sshf[1];
  var sei=useState(null); var editId=sei[0],setEditId=sei[1];
  var sfrm=useState(BLANK_FIL); var form=sfrm[0],setForm=sfrm[1];
  var sfe=useState(""); var formErr=sfe[0],setFormErr=sfe[1];
  var sdc=useState(null); var delConfirm=sdc[0],setDelConfirm=sdc[1];
  useEffect(function(){loadInv().then(setInv);},[]);
  async function save(u){setInv(u);await saveInv(u);}
  async function toggle(id){await save(inv.map(function(f){return f.id===id?Object.assign({},f,{enabled:!f.enabled}):f;}));}
  async function restock(id){await save(inv.map(function(f){return f.id===id?Object.assign({},f,{spoolsOwned:(f.spoolsOwned||0)+restockQty}):f;}));setRestockId(null);}
  var allTypes=["All"].concat(Array.from(new Set(inv.map(function(f){return f.type;}))).sort());
  var grouped={};inv.forEach(function(f){if(!grouped[f.type])grouped[f.type]=[];grouped[f.type].push(f);});
  var shopList=inv.filter(function(f){return f.enabled&&getRem(f)<=LOW_G;}).map(function(f){return Object.assign({},f,{remainingG:getRem(f),suggestSpools:Math.max(1,Math.ceil((LOW_G*3-getRem(f))/SPOOL_G))});});
  var totalVal=inv.filter(function(f){return f.enabled;}).reduce(function(a,f){return a+(getRem(f)/SPOOL_G)*f.price;},0);
  function openAdd(){setForm(BLANK_FIL);setEditId(null);setFormErr("");setShowForm(true);}
  function openEdit(f){setForm({type:f.type,colorName:f.color,hex:f.hex||"#888888",material:f.material,priceAUD:""+f.price,spoolsOwned:""+f.spoolsOwned});setEditId(f.id);setFormErr("");setShowForm(true);}
  function cancelForm(){setShowForm(false);setEditId(null);setForm(BLANK_FIL);setFormErr("");}
  async function submitForm(){setFormErr("");if(!form.type.trim()){setFormErr("Enter a filament type.");return;}if(!form.colorName.trim()){setFormErr("Enter a colour name.");return;}if(!validHex(form.hex)){setFormErr("Hex must be #RRGGBB format.");return;}var price=parseFloat(form.priceAUD),spools=parseInt(form.spoolsOwned);if(isNaN(price)||price<=0){setFormErr("Enter a valid price.");return;}if(isNaN(spools)||spools<0){setFormErr("Enter a valid spool count.");return;}
    if(editId){await save(inv.map(function(f){return f.id!==editId?f:Object.assign({},f,{type:form.type.trim(),color:form.colorName.trim(),hex:form.hex,material:form.material,price:price,spoolsOwned:spools,custom:true});}));}
    else{var isDupe=inv.some(function(f){return f.type.toLowerCase()===form.type.trim().toLowerCase()&&f.color.toLowerCase()===form.colorName.trim().toLowerCase();});if(isDupe){setFormErr("This filament type and colour already exists.");return;}await save(inv.concat([{id:"c-"+Date.now(),type:form.type.trim(),color:form.colorName.trim(),hex:form.hex,material:form.material,price:price,density:DENSITIES[form.material]||1.24,spoolsOwned:spools,usedG:0,enabled:true,custom:true}]));}
    cancelForm();}
  async function delFil(id){await save(inv.filter(function(f){return f.id!==id;}));setDelConfirm(null);}
  var groupEntries=Object.entries(grouped).filter(function(e){return filter==="All"||e[0]===filter;});
  return <div>
    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20 }}>
      <div>
        <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, marginBottom:4 }}>Filament Inventory</div>
        <div style={{ fontSize:12, color:"#374151" }}>{inv.filter(function(f){return f.enabled;}).length} active — {inv.filter(function(f){return f.custom;}).length} custom — Est. value: <span style={{ color:"#22c55e" }}>{fmtAUD(totalVal)}</span></div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        {shopList.length>0&&<button onClick={function(){sendShoppingEmail(shopList,admin);}} className="bh" style={{ background:"linear-gradient(135deg,#f59e0b,#d97706)", color:"#fff", border:"none", borderRadius:8, padding:"10px 16px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase" }}>Shopping List ({shopList.length})</button>}
        <button onClick={openAdd} className="bh" style={{ background:"linear-gradient(135deg,#f97316,#c2410c)", color:"#fff", border:"none", borderRadius:8, padding:"10px 16px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase", boxShadow:"0 0 16px rgba(249,115,22,0.3)" }}>+ Add Filament</button>
      </div>
    </div>
    {showForm&&<div style={{ background:"#0d1220", border:"1px solid rgba(249,115,22,0.25)", borderRadius:14, padding:20, marginBottom:20 }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, marginBottom:16, color:"#f97316" }}>{editId?"Edit Filament":"Add New Filament"}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        <div><Lbl>Filament Type</Lbl><input value={form.type} onChange={function(e){setForm(function(f){return Object.assign({},f,{type:e.target.value});});}} placeholder="e.g. PLA Basic, PETG..." style={smallInput}/></div>
        <div><Lbl>Colour Name</Lbl><input value={form.colorName} onChange={function(e){setForm(function(f){return Object.assign({},f,{colorName:e.target.value});});}} placeholder="e.g. Bambu Green..." style={smallInput}/></div>
        <div><Lbl>Hex Colour Code</Lbl>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <div style={{ position:"relative", width:42, height:38, borderRadius:7, overflow:"hidden", border:"2px solid #1a2035", flexShrink:0 }}>
              <div style={{ position:"absolute", inset:0, background:validHex(form.hex)?form.hex:"#888" }}/>
              <input type="color" value={validHex(form.hex)?form.hex:"#888888"} onChange={function(e){setForm(function(f){return Object.assign({},f,{hex:e.target.value});});}} style={{ position:"absolute", inset:0, opacity:0, width:"100%", height:"100%", cursor:"pointer", border:"none", padding:0 }}/>
            </div>
            <input value={form.hex} onChange={function(e){setForm(function(f){return Object.assign({},f,{hex:e.target.value});});}} placeholder="#f97316" maxLength={7} style={Object.assign({},smallInput,{letterSpacing:"0.08em",borderColor:form.hex&&!validHex(form.hex)?"#ef4444":undefined})}/>
            {validHex(form.hex)&&<div style={{ width:38, height:38, borderRadius:7, background:form.hex, flexShrink:0, border:"2px solid #1a2035", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:hexIsLight(form.hex)?"#111":"#fff", fontWeight:700 }}>Aa</div>}
          </div>
          {form.hex&&!validHex(form.hex)&&<div style={{ fontSize:10, color:"#ef4444", marginTop:4 }}>Must be #RRGGBB format</div>}
        </div>
        <div><Lbl>Material Type</Lbl><select value={form.material} onChange={function(e){setForm(function(f){return Object.assign({},f,{material:e.target.value});});}} style={selectStyle}>{MAT_TYPES.map(function(m){return <option key={m}>{m}</option>;})}</select></div>
        <div><Lbl>Price per Spool (AUD)</Lbl><input type="number" min="0.01" step="0.01" value={form.priceAUD} onChange={function(e){setForm(function(f){return Object.assign({},f,{priceAUD:e.target.value});});}} style={smallInput}/></div>
        <div><Lbl>Spools in Stock</Lbl><input type="number" min="0" max="99" value={form.spoolsOwned} onChange={function(e){setForm(function(f){return Object.assign({},f,{spoolsOwned:e.target.value});});}} style={smallInput}/></div>
      </div>
      {form.colorName&&form.type&&validHex(form.hex)&&<div style={{ background:"rgba(249,115,22,0.05)", border:"1px solid rgba(249,115,22,0.15)", borderRadius:9, padding:"12px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:"50%", background:form.hex, border:"3px solid rgba(249,115,22,0.4)", flexShrink:0 }}/>
        <div><div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{form.type} — {form.colorName}</div><div style={{ fontSize:10, color:"#4b5563", marginTop:2 }}>{form.material} — {fmtAUD(parseFloat(form.priceAUD)||0)}/spool — {form.spoolsOwned} spool(s)</div></div>
        <div style={{ marginLeft:"auto", fontSize:10, color:"#374151", fontFamily:"'DM Mono',monospace" }}>{form.hex}</div>
      </div>}
      {formErr&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"9px 12px", fontSize:12, color:"#ef4444", marginBottom:12 }}>{formErr}</div>}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={submitForm} className="bh" style={{ flex:1, background:"linear-gradient(135deg,#f97316,#c2410c)", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>{editId?"Save Changes":"Add to Inventory"}</button>
        <button onClick={cancelForm} style={{ flex:"0 0 auto", background:"transparent", color:"#4b5563", border:"1px solid #111827", borderRadius:8, padding:"11px 20px", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>}
    {shopList.length>0&&<div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:12, padding:16, marginBottom:20 }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14, color:"#ef4444", marginBottom:10 }}>⚠️ Running Low — Reorder Needed</div>
      {shopList.map(function(f){return <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, background:"rgba(239,68,68,0.05)", borderRadius:8, padding:"10px 12px", marginBottom:6 }}>
        <div style={{ width:28, height:28, borderRadius:"50%", background:f.hex, border:"2px solid rgba(239,68,68,0.3)", flexShrink:0 }}/>
        <div style={{ flex:1 }}><div style={{ fontSize:12, color:"#e2e8f0" }}>{f.type} — {f.color}</div><div style={{ fontSize:10, color:"#ef4444" }}>{f.remainingG.toFixed(0)}g remaining</div></div>
        <div style={{ textAlign:"right" }}><div style={{ fontSize:11, color:"#f59e0b" }}>Order {f.suggestSpools} spool(s)</div><div style={{ fontSize:10, color:"#374151" }}>{fmtAUD(f.suggestSpools*f.price)}</div></div>
      </div>;})}
    </div>}
    {delConfirm&&<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, backdropFilter:"blur(4px)" }}>
      <div style={{ background:"#0d1220", border:"1px solid rgba(239,68,68,0.3)", borderRadius:14, padding:24, maxWidth:380, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🗑️</div>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, marginBottom:8 }}>Delete this filament?</div>
        <div style={{ fontSize:12, color:"#4b5563", marginBottom:6 }}>{delConfirm.type} — {delConfirm.color}</div>
        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button onClick={function(){delFil(delConfirm.id);}} className="bh" style={{ flex:1, background:"#ef4444", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", textTransform:"uppercase" }}>Delete</button>
          <button onClick={function(){setDelConfirm(null);}} style={{ flex:1, background:"transparent", color:"#4b5563", border:"1px solid #111827", borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>Cancel</button>
        </div>
      </div>
    </div>}
    <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:16 }}>
      {allTypes.map(function(t){return <button key={t} onClick={function(){setFilter(t);}} className="bh" style={{ background:filter===t?"#f97316":"transparent", color:filter===t?"#fff":"#4b5563", border:"1px solid "+(filter===t?"#f97316":"#111827"), borderRadius:5, padding:"5px 11px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer", letterSpacing:"0.06em", textTransform:"uppercase" }}>{t}</button>;})}
    </div>
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {groupEntries.map(function(entry){
        var type=entry[0],items=entry[1];
        return <div key={type} style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
          <div style={{ padding:"10px 15px", borderBottom:"1px solid #111827", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13, color:"#e2e8f0" }}>{type}</span>
            {items[0].custom&&<span style={{ fontSize:8, background:"rgba(168,85,247,0.15)", color:"#a855f7", borderRadius:4, padding:"2px 7px" }}>CUSTOM</span>}
            <span style={{ fontSize:10, color:"#374151" }}>{items[0].material} — {fmtAUD(items[0].price)}/spool</span>
          </div>
          {items.map(function(f,i){
            var rem=getRem(f),pct=Math.min(100,rem/Math.max(1,(f.spoolsOwned||0)*SPOOL_G)*100);
            var st=getStockStatus(f),ss=STATUS_STYLE[st];
            var barBg=st==="ok"?"#22c55e":st==="low"?"#f59e0b":"#ef4444";
            return <div key={f.id} style={{ padding:"11px 15px", borderBottom:i<items.length-1?"1px solid #080d16":"none", opacity:f.enabled?1:0.5 }}>
              <div style={{ display:"grid", gridTemplateColumns:"38px 1fr 200px auto", alignItems:"center", gap:12 }}>
                <div style={{ position:"relative", width:32, height:32, borderRadius:8, background:f.hex, border:"2px solid #1a2035", flexShrink:0, boxShadow:hexIsLight(f.hex)?"inset 0 0 0 1px rgba(0,0,0,0.15)":"none" }}>
                  <div style={{ position:"absolute", bottom:-4, right:-4, background:"#080d16", borderRadius:3, padding:"0px 3px", fontSize:7, color:"#374151", fontFamily:"'DM Mono',monospace", border:"1px solid #1a2035" }}>{f.hex}</div>
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ fontSize:13, color:f.enabled?"#e2e8f0":"#4b5563", fontWeight:500 }}>{f.color}</span>{f.custom&&<span style={{ fontSize:8, color:"#a855f7", background:"rgba(168,85,247,0.1)", borderRadius:3, padding:"1px 5px" }}>custom</span>}</div>
                  <div style={{ fontSize:9, color:"#1f2937", marginTop:1 }}>{f.enabled?"Available to teachers":"Hidden from teachers"}</div>
                </div>
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}><span style={{ fontSize:10, color:"#4b5563" }}>{rem.toFixed(0)}g / {(f.spoolsOwned||0)*SPOOL_G}g</span><span style={{ fontSize:9, background:ss.bg, color:ss.color, borderRadius:3, padding:"1px 5px" }}>{ss.label}</span></div>
                  <div style={{ height:5, background:"#111827", borderRadius:3 }}><div style={{ width:pct+"%", height:"100%", background:barBg, borderRadius:3, transition:"width .3s" }}/></div>
                </div>
                <div style={{ display:"flex", gap:5, alignItems:"center", justifyContent:"flex-end" }}>
                  {restockId===f.id?<div style={{ display:"flex", gap:4, alignItems:"center" }}>
                    <input type="number" min={1} max={20} value={restockQty} onChange={function(e){setRestockQty(parseInt(e.target.value)||1);}} style={{ width:46, background:"#050810", border:"1px solid #1a2035", borderRadius:5, padding:"4px 6px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:11, outline:"none" }}/>
                    <button onClick={function(){restock(f.id);}} style={{ background:"#22c55e", color:"#fff", border:"none", borderRadius:5, padding:"4px 8px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>Add</button>
                    <button onClick={function(){setRestockId(null);}} style={{ background:"transparent", color:"#4b5563", border:"1px solid #111827", borderRadius:5, padding:"4px 6px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>x</button>
                  </div>:<button onClick={function(){setRestockId(f.id);setRestockQty(1);}} style={{ background:"transparent", color:"#22c55e", border:"1px solid rgba(34,197,94,0.3)", borderRadius:5, padding:"4px 9px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer", whiteSpace:"nowrap" }}>+ Stock</button>}
                  <button onClick={function(){toggle(f.id);}} className="bh" style={{ background:f.enabled?"rgba(249,115,22,0.1)":"rgba(75,85,99,0.1)", color:f.enabled?"#f97316":"#4b5563", border:"1px solid "+(f.enabled?"rgba(249,115,22,0.3)":"rgba(75,85,99,0.3)"), borderRadius:5, padding:"4px 9px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>{f.enabled?"Active":"Hidden"}</button>
                  <button onClick={function(){openEdit(f);}} className="bh" style={{ background:"rgba(59,130,246,0.08)", color:"#3b82f6", border:"1px solid rgba(59,130,246,0.25)", borderRadius:5, padding:"4px 9px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>Edit</button>
                  {f.custom&&<button onClick={function(){setDelConfirm(f);}} className="bh" style={{ background:"rgba(239,68,68,0.07)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.2)", borderRadius:5, padding:"4px 9px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>Del</button>}
                </div>
              </div>
            </div>;
          })}
        </div>;
      })}
    </div>
  </div>;
}

// ─── Admin Insights ───────────────────────────────────────────────────────────
function AdminInsights({ requests }) {
  var byDept={};requests.forEach(function(r){var d=r.department||"General";if(!byDept[d])byDept[d]={dept:d,prints:0,pieces:0,cost:0,filamentG:0};byDept[d].prints++;byDept[d].pieces+=r.quantity;byDept[d].filamentG+=r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity);byDept[d].cost+=r.estimatedCostAUD||0;});
  var deptData=Object.values(byDept).sort(function(a,b){return b.prints-a.prints;});
  var byPerson={};requests.forEach(function(r){var k=r.teacherName;if(!byPerson[k])byPerson[k]={name:k,dept:r.department||"General",prints:0,pieces:0,cost:0,filamentG:0};byPerson[k].prints++;byPerson[k].pieces+=r.quantity;byPerson[k].filamentG+=r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity);byPerson[k].cost+=r.estimatedCostAUD||0;});
  var personData=Object.values(byPerson).sort(function(a,b){return b.prints-a.prints;});
  var byMat={};requests.forEach(function(r){byMat[r.material]=(byMat[r.material]||0)+r.quantity;});
  var matData=Object.entries(byMat).map(function(e){return{name:e[0],value:e[1]};});
  var byStat={};requests.forEach(function(r){byStat[r.status]=(byStat[r.status]||0)+1;});
  var statData=Object.entries(byStat).map(function(e){return{name:e[0],value:e[1]};});
  var statColors={Queued:"#f59e0b",Printing:"#3b82f6",Done:"#22c55e",Cancelled:"#4b5563"};
  var totalCost=requests.reduce(function(a,r){return a+(r.estimatedCostAUD||0);},0);
  var totalFilG=requests.reduce(function(a,r){return a+(r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity));},0);
  var ttS={background:"#0d1220",border:"1px solid #111827",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#e2e8f0"};
  return <div>
    <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, marginBottom:20 }}>Admin Insights</div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
      <StatCard emoji="📋" value={""+requests.length} label="Total Requests" color="#4b5563"/>
      <StatCard emoji="💰" value={fmtAUD(totalCost)} label="Total Material Cost" color="#f59e0b"/>
      <StatCard emoji="🧶" value={(totalFilG/1000).toFixed(2)+" kg"} label="Filament Used" color="#f97316"/>
      <StatCard emoji="📐" value={fmtAUD(requests.length?totalCost/requests.length:0)} label="Avg Cost / Job" color="#3b82f6"/>
    </div>
    {requests.length===0?<div style={{ textAlign:"center", padding:"60px 0", color:"#1f2937" }}><div style={{ fontSize:44, marginBottom:12, opacity:0.15 }}>📊</div><div style={{ fontSize:14 }}>Insights will appear as requests come in</div></div>
    :<div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <Card title="Prints by Department"><ResponsiveContainer width="100%" height={200}><BarChart data={deptData} margin={{top:0,right:0,left:-20,bottom:0}}><XAxis dataKey="dept" tick={{fill:"#4b5563",fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#4b5563",fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={ttS} cursor={{fill:"rgba(249,115,22,0.06)"}}/><Bar dataKey="prints" fill="#f97316" radius={[4,4,0,0]} name="Jobs"/></BarChart></ResponsiveContainer></Card>
        <Card title="Cost by Department"><ResponsiveContainer width="100%" height={200}><BarChart data={deptData} margin={{top:0,right:0,left:-10,bottom:0}}><XAxis dataKey="dept" tick={{fill:"#4b5563",fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#4b5563",fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={ttS} cursor={{fill:"rgba(59,130,246,0.06)"}}/><Bar dataKey="cost" fill="#3b82f6" radius={[4,4,0,0]} name="Cost AUD"/></BarChart></ResponsiveContainer></Card>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <Card title="Material Breakdown"><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={matData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">{matData.map(function(e,i){return <Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>;})}</Pie><Tooltip contentStyle={ttS}/></PieChart></ResponsiveContainer></Card>
        <Card title="Queue Status"><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={statData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">{statData.map(function(e,i){return <Cell key={i} fill={statColors[e.name]||CHART_COLORS[i]}/>;})}</Pie><Tooltip contentStyle={ttS}/></PieChart></ResponsiveContainer></Card>
      </div>
      <Card title="Department Breakdown">
        <div style={{ overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr>{["Department","Jobs","Pieces","Filament","Cost","Avg/Job"].map(function(h){return <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:9, color:"#374151", letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:"1px solid #111827" }}>{h}</th>;})}</tr></thead>
          <tbody>{deptData.map(function(d,i){return <tr key={d.dept} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
            <td style={{ padding:"10px", fontSize:12, color:"#e2e8f0", borderBottom:"1px solid #0d1220" }}>{d.dept}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#6b7280", borderBottom:"1px solid #0d1220" }}>{d.prints}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#6b7280", borderBottom:"1px solid #0d1220" }}>{d.pieces}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#f97316", borderBottom:"1px solid #0d1220" }}>{d.filamentG.toFixed(0)}g</td>
            <td style={{ padding:"10px", fontSize:12, color:"#f59e0b", borderBottom:"1px solid #0d1220" }}>{fmtAUD(d.cost)}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#6b7280", borderBottom:"1px solid #0d1220" }}>{fmtAUD(d.cost/(d.prints||1))}</td>
          </tr>;})}
          </tbody>
        </table></div>
      </Card>
      <Card title="Per-Teacher Breakdown">
        <div style={{ overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr>{["Teacher","Department","Jobs","Pieces","Filament","Cost"].map(function(h){return <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:9, color:"#374151", letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:"1px solid #111827" }}>{h}</th>;})}</tr></thead>
          <tbody>{personData.map(function(p,i){return <tr key={p.name} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
            <td style={{ padding:"10px", fontSize:12, color:"#e2e8f0", borderBottom:"1px solid #0d1220" }}>{p.name}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#6b7280", borderBottom:"1px solid #0d1220" }}>{p.dept}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#6b7280", borderBottom:"1px solid #0d1220" }}>{p.prints}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#6b7280", borderBottom:"1px solid #0d1220" }}>{p.pieces}</td>
            <td style={{ padding:"10px", fontSize:12, color:"#f97316", borderBottom:"1px solid #0d1220" }}>{p.filamentG.toFixed(0)}g</td>
            <td style={{ padding:"10px", fontSize:12, color:"#f59e0b", borderBottom:"1px solid #0d1220" }}>{fmtAUD(p.cost)}</td>
          </tr>;})}
          </tbody>
        </table></div>
      </Card>
    </div>}
  </div>;
}

// ─── Request Templates ─────────────────────────────────────────────────────────
function TemplatesModal({ onUse, onClose }) {
  var st=useState([]); var templates=st[0],setTemplates=st[1];
  var ss=useState(""); var msg=ss[0],setMsg=ss[1];
  useEffect(function(){loadTemplates().then(setTemplates);},[]);
  async function del(id){var u=templates.filter(function(t){return t.id!==id;});await saveTemplates(u);setTemplates(u);}
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:560, background:"#0d1220", border:"1px solid #111827", borderRadius:16, overflow:"hidden", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
      <div style={{ borderBottom:"1px solid #111827", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15 }}>📋 Saved Templates</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:18 }}>×</button>
      </div>
      <div style={{ padding:20, overflowY:"auto" }}>
        {templates.length===0?<div style={{ textAlign:"center", padding:"32px 0", color:"#374151" }}><div style={{ fontSize:32, marginBottom:10 }}>📭</div>No saved templates yet. Submit a print request and save it as a template for quick reuse!</div>
        :<div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {templates.map(function(t){return <div key={t.id} style={{ background:"#080d16", border:"1px solid #111827", borderRadius:10, padding:"12px 15px", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{t.projectName}</div>
              <div style={{ fontSize:10, color:"#374151", marginTop:2 }}>{t.material} — {t.color} — x{t.quantity} — {t.department||"No dept"}</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={function(){onUse(t);onClose();}} className="bh" style={{ background:"rgba(249,115,22,0.1)", color:"#f97316", border:"1px solid rgba(249,115,22,0.3)", borderRadius:6, padding:"5px 12px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer", letterSpacing:"0.06em" }}>Use</button>
              <button onClick={function(){del(t.id);}} className="bh" style={{ background:"rgba(239,68,68,0.07)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.2)", borderRadius:6, padding:"5px 10px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>Del</button>
            </div>
          </div>;})}
        </div>}
      </div>
    </div>
  </div>;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function PrintPortal() {
  var sw=useWidth();
  var isMobile=sw<768;

  var sv=useState("submit"); var view=sv[0],setView=sv[1];
  var sreqs=useState([]); var requests=sreqs[0],setRequests=sreqs[1];
  var sload=useState(true); var loading=sload[0],setLoading=sload[1];
  var sadmin=useState(null); var admin=sadmin[0],setAdmin=sadmin[1];
  var scpw=useState(false); var showCPw=scpw[0],setShowCPw=scpw[1];
  var sma=useState(false); var showMA=sma[0],setShowMA=sma[1];
  var sps=useState(false); var showPrinterSettings=sps[0],setShowPrinterSettings=sps[1];
  var stpl=useState(false); var showTemplates=stpl[0],setShowTemplates=stpl[1];
  var sstep=useState(0); var step=sstep[0],setStep=sstep[1];
  var sform=useState({teacherName:"",email:"",department:"",projectName:"",purpose:"",quantity:1,dueDate:"",material:"PLA",color:"Any",notes:"",sourceUrl:""});
  var form=sform[0],setForm=sform[1];
  var sstl=useState(null); var stlFile=sstl[0],setStlFile=sstl[1];
  var sstats=useState(null); var stlStats=sstats[0],setStlStats=sstats[1];
  var serr=useState(""); var stlError=serr[0],setStlError=serr[1];
  var spars=useState(false); var parsing=spars[0],setParsing=spars[1];
  var ssub=useState(false); var submitted=ssub[0],setSubmitted=ssub[1];
  var sconf=useState(false); var showConfetti=sconf[0],setShowConfetti=sconf[1];
  var sfilt=useState("All"); var filterStatus=sfilt[0],setFilterStatus=sfilt[1];
  var ssel=useState(null); var selReq=ssel[0],setSelReq=ssel[1];
  var scstart=useState(false); var confStart=scstart[0],setConfStart=scstart[1];
  var snote=useState(""); var adminNote=snote[0],setAdminNote=snote[1];
  var surl=useState(""); var urlInfo=surl[0],setUrlInfo=surl[1];
  var sreadyDate=useState(null); var submittedReadyDate=sreadyDate[0],setSubmittedReadyDate=sreadyDate[1];
  var smenu=useState(false); var mobileMenu=smenu[0],setMobileMenu=smenu[1];
  var fileRef=useRef(null),dragRef=useRef(null);

  useEffect(function(){loadReqs().then(function(r){setRequests(r);setLoading(false);});},[]);

  function syncSel(updated) { if(selReq){var f=updated.filter(function(r){return r.id===selReq.id;})[0];if(f)setSelReq(f);} }
  function handleLogin(a){setAdmin(a);if(a.mustReset)setShowCPw(true);}

  function cleanName(str) {
    return str
      .replace(/[_.]+/g," ").replace(/[-]+/g," ")
      .replace(/\.stl$/i,"")
      .split(" ").map(function(w){return w.length>0?w.charAt(0).toUpperCase()+w.slice(1).toLowerCase():w;}).join(" ")
      .trim();
  }
  function detectPlatform(url){if(!url)return null;if(url.indexOf("thingiverse.com")>=0)return"Thingiverse";if(url.indexOf("printables.com")>=0)return"Printables";if(url.indexOf("myminifactory.com")>=0)return"MyMiniFactory";if(url.indexOf("cults3d.com")>=0)return"Cults3D";if(url.indexOf("thangs.com")>=0)return"Thangs";if(url.indexOf("tinkercad.com")>=0)return"Tinkercad";if(url.indexOf("makerworld.com")>=0)return"MakerWorld";return null;}
  function extractNameFromUrl(url){try{var u=new URL(url);var parts=u.pathname.split("/").filter(function(p){return p.length>2;});var last=parts[parts.length-1]||"";last=last.replace(/^[a-z0-9]+[:\-]?[0-9]+$/i,"").replace(/^[0-9]+$/,"").replace(/[:\-_]+$/,"");if(!last&&parts.length>1)last=parts[parts.length-2]||"";return cleanName(last);}catch(e){return"";}}

  function handleUrlInput(url){
    setForm(function(f){return Object.assign({},f,{sourceUrl:url});});
    if(!url||url.length<10){setUrlInfo("");return;}
    var platform=detectPlatform(url);var name=extractNameFromUrl(url);
    setUrlInfo("Found on "+(platform||"Web")+(name?" — "+name:""));
    if(name){setForm(function(f){return Object.assign({},f,{sourceUrl:url,projectName:f.projectName?f.projectName:name});});}
  }

  var handleFile=useCallback(async function(file){
    if(!file)return;
    if(!file.name.toLowerCase().endsWith(".stl")){setStlError("Please upload a .stl file.");setStlFile(null);setStlStats(null);return;}
    setStlError("");setStlFile(file);setStlStats(null);setParsing(true);
    var guessed=cleanName(file.name.replace(/\.stl$/i,""));
    setForm(function(f){return Object.assign({},f,{projectName:f.projectName?f.projectName:guessed});});
    try{var buf=await file.arrayBuffer();var stats=parseSTL(buf);if(!stats)throw new Error("Cannot parse this file.");setStlStats(stats);}
    catch(e){setStlError("Could not read file: "+e.message);setStlStats(null);}
    finally{setParsing(false);}
  },[]);

  function onDrop(e){e.preventDefault();if(dragRef.current)dragRef.current.classList.remove("drag-over");handleFile(e.dataTransfer.files[0]);}

  async function saveTemplate(){
    var t={id:"t-"+Date.now(),projectName:form.projectName,purpose:form.purpose,quantity:form.quantity,material:form.material,color:form.color,department:form.department,notes:form.notes};
    var existing=await loadTemplates();await saveTemplates(existing.concat([t]));
    alert("Template saved: "+t.projectName);
  }

  function useTemplate(t){setForm(function(f){return Object.assign({},f,{projectName:t.projectName,purpose:t.purpose||"",quantity:t.quantity,material:t.material,color:t.color,department:t.department||"",notes:t.notes||""});});}

  async function handleSubmit(){
    var statsClean=null;
    if(stlStats){statsClean=Object.assign({},stlStats);delete statsClean.rawVertices;}
    var readyDate=estimateReadyDate(requests,{stlStats:statsClean,quantity:form.quantity});
    var req=Object.assign({},form,{id:Date.now()+"",fileName:stlFile.name,fileSize:stlFile.size,stlStats:statsClean,submittedAt:new Date().toISOString(),status:"Queued",log:[],estimatedReadyDate:readyDate.toISOString()});
    var updated=[req].concat(requests);setRequests(updated);await saveReqs(updated);
    setSubmittedReadyDate(readyDate);
    setShowConfetti(true);setSubmitted(true);
    setTimeout(function(){setShowConfetti(false);},3000);
    setTimeout(function(){setSubmitted(false);setStep(0);setForm({teacherName:"",email:"",department:"",projectName:"",purpose:"",quantity:1,dueDate:"",material:"PLA",color:"Any",notes:"",sourceUrl:""});setStlFile(null);setStlStats(null);setUrlInfo("");setSubmittedReadyDate(null);},3500);
  }

  function addLog(req,msg){return(req.log||[]).concat([{msg:msg,by:admin?admin.name:"",at:new Date().toISOString()}]);}

  async function updateStatus(id,status,extra){
    var updated=requests.map(function(r){if(r.id!==id)return r;return Object.assign({},r,{status:status},extra||{},{log:addLog(r,"Status: "+status)});});
    setRequests(updated);await saveReqs(updated);syncSel(updated);
  }

  async function startPrint(req){
    var startedAt=new Date().toISOString();
    var updated=requests.map(function(r){if(r.id!==req.id)return r;return Object.assign({},r,{status:"Printing",printStartedAt:startedAt,log:addLog(r,"Print started")});});
    setRequests(updated);await saveReqs(updated);
    var fresh=updated.filter(function(r){return r.id===req.id;})[0];setSelReq(fresh);
    sendStartEmail(fresh,admin,adminNote);setAdminNote("");setConfStart(false);
  }

  async function markDone(req){
    var wG=estWeight(req.stlStats,req.material,req.quantity);
    var inv=await loadInv();
    var match=null;for(var i=0;i<inv.length;i++){if(inv[i].enabled&&inv[i].material===req.material&&(req.color==="Any"||inv[i].color===req.color)){match=inv[i];break;}}
    var costAUD=match?estCost(wG,match.price):estCost(wG,24.99);
    var updInv=inv.map(function(f){return f.id===(match?match.id:"")?Object.assign({},f,{usedG:(f.usedG||0)+wG}):f;});
    await saveInv(updInv);
    var updated=requests.map(function(r){if(r.id!==req.id)return r;return Object.assign({},r,{status:"Done",filamentUsedG:wG,estimatedCostAUD:costAUD,log:addLog(r,"Done — "+wG.toFixed(0)+"g — "+fmtAUD(costAUD))});});
    setRequests(updated);await saveReqs(updated);syncSel(updated);
    sendReadyEmail(req,admin,adminNote);setAdminNote("");
  }

  async function reorder(id,dir){
    var idx=requests.findIndex(function(r){return r.id===id;});
    if(idx<0)return;var arr=requests.slice();
    var swap=idx+dir;if(swap<0||swap>=arr.length)return;
    var tmp=arr[idx];arr[idx]=arr[swap];arr[swap]=tmp;
    setRequests(arr);await saveReqs(arr);
  }

  async function deleteReq(id){var updated=requests.filter(function(r){return r.id!==id;});setRequests(updated);await saveReqs(updated);if(selReq&&selReq.id===id)setSelReq(null);}

  function getDueDateWarn(){
    if(!form.dueDate||!stlStats)return null;
    var th=stlStats.estimatedHours*form.quantity*0.85;
    var days=(new Date(form.dueDate)-Date.now())/86400000;
    var need=th/8+1;
    if(days<0)return{t:"error",msg:"That date is in the past!"};
    if(days<need)return{t:"warn",msg:"This print takes "+fmtH(th)+" — allow at least "+Math.ceil(need)+" day(s)."};
    return{t:"ok",msg:"Great — that gives plenty of time."};
  }
  var DW=getDueDateWarn();
  var filtered=filterStatus==="All"?requests:requests.filter(function(r){return r.status===filterStatus;});
  var qs={q:requests.filter(function(r){return r.status==="Queued";}).length,p:requests.filter(function(r){return r.status==="Printing";}).length,d:requests.filter(function(r){return r.status==="Done";}).length};
  var isAdminView=view==="log"||view==="inventory"||view==="insights"||view==="report";
  var TABS=[["submit","➕ New Request",false],["status","📬 My Status",false],["stats","🌟 Stats",false],["log","📋 Queue ("+requests.length+")",true],["inventory","🧶 Filament",true],["insights","📊 Insights",true],["report","📅 Report",true]];

  return <div style={{ minHeight:"100vh", background:"#050810", fontFamily:"'DM Mono','Courier New',monospace", color:"#e2e8f0" }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      html{-webkit-text-size-adjust:100%}body{-webkit-font-smoothing:antialiased}
      ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#080d16}::-webkit-scrollbar-thumb{background:#f97316;border-radius:2px}
      .drag-over{border-color:#f97316!important;background:rgba(249,115,22,0.07)!important}
      input:focus,select:focus,textarea:focus{border-color:#f97316!important;box-shadow:0 0 0 3px rgba(249,115,22,0.1)!important;outline:none}
      select option{background:#1a1a2e;color:#e2e8f0}
      @keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      @keyframes cf{to{transform:translateY(110vh) rotate(720deg);opacity:0}}
      @keyframes ci{0%{transform:scale(0)}70%{transform:scale(1.15)}100%{transform:scale(1)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
      @keyframes glow{0%,100%{box-shadow:0 0 18px rgba(249,115,22,0.3)}50%{box-shadow:0 0 32px rgba(249,115,22,0.55)}}
      .fu{animation:fu .3s ease forwards}.ci{animation:ci .45s cubic-bezier(.17,.67,.55,1.43) forwards}.pulse{animation:pulse 1.5s infinite}
      .bh{transition:all .15s;cursor:pointer;-webkit-tap-highlight-color:rgba(249,115,22,0.15)}.bh:hover{filter:brightness(1.15)}
      .rh{transition:background .12s;cursor:pointer}.rh:hover{background:rgba(249,115,22,0.04)!important}
      .mc{transition:all .2s;cursor:pointer}.mc:hover{transform:translateY(-2px)}
      .cs{transition:all .15s;cursor:pointer}.cs:hover{transform:scale(1.12)}
      .g4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
      .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .g2s{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      .gc2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
      .det{display:grid;grid-template-columns:1fr 420px;gap:20px;align-items:start}
      .qrow{display:grid;grid-template-columns:28px 2fr 1.4fr 1fr 1fr 1fr 110px;padding:12px 16px;align-items:center}
      .qhead{display:grid;grid-template-columns:28px 2fr 1.4fr 1fr 1fr 1fr 110px;padding:10px 16px}
      @media(max-width:1024px){.g4{grid-template-columns:repeat(2,1fr)}.det{grid-template-columns:1fr}}
      @media(max-width:768px){.g4{grid-template-columns:1fr 1fr;gap:8px}.g2{grid-template-columns:1fr}.g2s{grid-template-columns:1fr}.g3{grid-template-columns:1fr 1fr}.gc2{grid-template-columns:1fr}.det{grid-template-columns:1fr}.qrow{grid-template-columns:28px 1fr auto}.qhead{display:none}.hmob{display:none}}
      @media(max-width:480px){.g4{grid-template-columns:1fr 1fr;gap:6px}.g3{grid-template-columns:1fr}}
      @media print{nav,button,.no-print{display:none!important}.print-only{display:block}}
    `}</style>

    {showConfetti&&<Confetti/>}
    {showCPw&&admin&&<ChangePasswordModal admin={admin} forced={admin.mustReset} onDone={function(a){setAdmin(a);setShowCPw(false);}} onCancel={function(){setShowCPw(false);}}/>}
    {showMA&&admin&&<ManageAdmins currentAdmin={admin} onClose={function(){setShowMA(false);}}/>}
    {showPrinterSettings&&<PrinterSettings onClose={function(){setShowPrinterSettings(false);}}/>}
    {showTemplates&&<TemplatesModal onUse={useTemplate} onClose={function(){setShowTemplates(false);}}/>}

    {/* NAV */}
    <nav style={{ borderBottom:"1px solid #0d1220", background:"rgba(5,8,16,0.97)", backdropFilter:"blur(10px)", position:"sticky", top:0, zIndex:100 }}>
      <div style={{ maxWidth:1300, margin:"0 auto", padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{ width:32, height:32, background:"linear-gradient(135deg,#f97316,#c2410c)", borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 18px rgba(249,115,22,0.4)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div><div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:900, letterSpacing:"-0.03em", color:"#fff", lineHeight:1 }}>PRINT<span style={{ color:"#f97316" }}>LAB</span></div><div style={{ fontSize:7, color:"#1f2937", letterSpacing:"0.14em" }}>MACC 3D PORTAL</div></div>
        </div>
        {isMobile?<button onClick={function(){setMobileMenu(function(m){return !m;});}} style={{ background:"none", border:"1px solid #111827", borderRadius:7, padding:"6px 10px", color:"#e2e8f0", cursor:"pointer", fontSize:16 }}>☰</button>
        :<div style={{ display:"flex", alignItems:"center", gap:5, overflow:"auto" }}>
          {TABS.map(function(tab){
            var v=tab[0],l=tab[1],req=tab[2];
            var active=view===v,locked=req&&!admin;
            return <button key={v} className="bh" onClick={function(){setView(v);}} style={{ background:active?"#f97316":"transparent", color:active?"#fff":locked?"#1f2937":"#4b5563", border:"1px solid "+(active?"#f97316":locked?"#0d1220":"#111827"), borderRadius:6, padding:"5px 10px", fontFamily:"inherit", fontSize:9, cursor:"pointer", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>{l}{locked?" 🔒":""}</button>;
          })}
          {admin&&<div style={{ display:"flex", alignItems:"center", gap:6, background:"#0d1220", border:"1px solid #111827", borderRadius:8, padding:"4px 8px 4px 5px", marginLeft:4 }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:"linear-gradient(135deg,#f97316,#c2410c)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:11, color:"#fff" }}>{admin.name.charAt(0)}</div>
            <div><div style={{ fontSize:9, color:"#e2e8f0", lineHeight:1 }}>{admin.name}</div><div style={{ fontSize:7, color:"#374151" }}>{admin.role}</div></div>
            <div style={{ display:"flex", gap:3, marginLeft:3 }}>
              <button className="bh" onClick={function(){setShowCPw(true);}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#374151", cursor:"pointer", fontSize:9 }}>🔑</button>
              <button className="bh" onClick={function(){setShowPrinterSettings(true);}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#374151", cursor:"pointer", fontSize:9 }}>🖨️</button>
              {admin.role==="Head of STEM"&&<button className="bh" onClick={function(){setShowMA(true);}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#374151", cursor:"pointer", fontSize:9 }}>👥</button>}
              <button className="bh" onClick={function(){setAdmin(null);setView("submit");}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#374151", cursor:"pointer", fontSize:9 }}>↩</button>
            </div>
          </div>}
        </div>}
      </div>
      {isMobile&&mobileMenu&&<div style={{ borderTop:"1px solid #111827", background:"#080d16", padding:"10px 16px", display:"flex", flexDirection:"column", gap:6 }}>
        {TABS.map(function(tab){var v=tab[0],l=tab[1],req=tab[2];var locked=req&&!admin;return <button key={v} className="bh" onClick={function(){setView(v);setMobileMenu(false);}} style={{ background:view===v?"#f97316":"transparent", color:view===v?"#fff":locked?"#1f2937":"#4b5563", border:"1px solid "+(view===v?"#f97316":"#111827"), borderRadius:6, padding:"8px 14px", fontFamily:"inherit", fontSize:11, cursor:"pointer", textAlign:"left" }}>{l}{locked?" 🔒":""}</button>;})}
      </div>}
    </nav>

    <div style={{ maxWidth:1300, margin:"0 auto", padding:"24px 16px" }}>

      {view==="stats"&&<PublicStats requests={requests}/>}
      {view==="status"&&<TeacherStatus requests={requests}/>}
      {isAdminView&&!admin&&<AdminLogin onLogin={handleLogin}/>}
      {view==="inventory"&&admin&&<FilamentInventory requests={requests} admin={admin}/>}
      {view==="insights"&&admin&&<AdminInsights requests={requests}/>}
      {view==="report"&&admin&&<MonthlyReport requests={requests}/>}

      {/* ── SUBMIT WIZARD ── */}
      {view==="submit"&&<div>
        {submitted?<div style={{ textAlign:"center", padding:"80px 0" }}>
          <div className="ci" style={{ fontSize:80, marginBottom:16 }}>🎉</div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900, color:"#22c55e" }}>You're all set!</div>
          <div style={{ color:"#374151", marginTop:10, fontSize:14, lineHeight:1.8 }}>Your print request is in the queue.<br/>You'll get an email when printing starts.</div>
          {submittedReadyDate&&<div style={{ marginTop:16, background:"rgba(249,115,22,0.08)", border:"1px solid rgba(249,115,22,0.2)", borderRadius:10, padding:"12px 20px", display:"inline-block" }}>
            <div style={{ fontSize:10, color:"#f97316", letterSpacing:"0.1em", marginBottom:4 }}>ESTIMATED READY DATE</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"#f97316" }}>{formatReadyDate(submittedReadyDate)}</div>
            <div style={{ fontSize:10, color:"#4b5563", marginTop:3 }}>Based on current queue — may change</div>
          </div>}
        </div>:
        <div style={{ maxWidth:720, margin:"0 auto" }}>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:24, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1.1, marginBottom:5 }}>
              {["👋 Let's get started!","📐 About your print","✅ Review & submit"][step]}
            </div>
            <div style={{ fontSize:12, color:"#374151" }}>
              {["Tell us who you are, upload your STL and we'll do the rest.","What are you printing, when do you need it, and what material?","Everything look right? Hit submit!"][step]}
            </div>
          </div>
          <StepBar step={step} steps={["Your Details & File","Print Options","Review"]}/>

          {/* Step 0 */}
          {step===0&&<div className="fu" style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button onClick={function(){setShowTemplates(true);}} className="bh" style={{ background:"rgba(168,85,247,0.1)", color:"#a855f7", border:"1px solid rgba(168,85,247,0.3)", borderRadius:7, padding:"6px 14px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.06em" }}>📋 Use Saved Template</button>
            </div>
            <Card title="Your details">
              <div className="g2s">
                <div><Lbl>Your name</Lbl><input value={form.teacherName} placeholder="e.g. Ms. Johnson" onChange={function(e){setForm(function(f){return Object.assign({},f,{teacherName:e.target.value});});}} style={baseInput}/></div>
                <div><Lbl>School email</Lbl><input value={form.email} placeholder="you@macc.nsw.edu.au" onChange={function(e){setForm(function(f){return Object.assign({},f,{email:e.target.value});});}} style={baseInput}/><div style={{ fontSize:10, color:"#374151", marginTop:4 }}>We'll email you when your print is ready</div></div>
              </div>
              <div><Lbl>Department</Lbl>
                <select value={form.department} onChange={function(e){setForm(function(f){return Object.assign({},f,{department:e.target.value});});}} style={selectStyle}>
                  <option value="">— Select your department —</option>
                  {DEPARTMENTS.map(function(d){return <option key={d} value={d}>{d}</option>;})}
                </select>
              </div>
            </Card>

            <Card title="Upload Your 3D File">
              <div style={{ background:"rgba(249,115,22,0.04)", border:"1px solid rgba(249,115,22,0.1)", borderRadius:8, padding:"10px 12px", fontSize:11, color:"#6b7280", lineHeight:1.7 }}>
                <strong style={{ color:"#9ca3af" }}>What's an STL file?</strong> Export from Tinkercad, Fusion 360, Printables, etc. We'll auto-fill your project name from the file and URL.
              </div>
              <div>
                <Lbl>Source URL (optional)</Lbl>
                <div style={{ position:"relative" }}>
                  <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, pointerEvents:"none", opacity:0.5 }}>🔗</div>
                  <input value={form.sourceUrl} onChange={function(e){handleUrlInput(e.target.value);}} placeholder="https://www.printables.com/model/..." style={Object.assign({},baseInput,{paddingLeft:34,fontSize:12})}/>
                </div>
                {urlInfo&&<div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#22c55e" }}><span>✅</span><span>{urlInfo}</span></div>}
                <div style={{ fontSize:10, color:"#374151", marginTop:4 }}>Supports Thingiverse, Printables, MyMiniFactory, MakerWorld, Cults3D, Tinkercad, Thangs</div>
              </div>
              <div style={{ borderTop:"1px solid #111827", paddingTop:14 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <Lbl>STL File *</Lbl>
                  <button className="bh" onClick={function(){if(fileRef.current)fileRef.current.click();}} style={{ background:"rgba(249,115,22,0.1)", color:"#f97316", border:"1px solid rgba(249,115,22,0.3)", borderRadius:6, padding:"4px 12px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.06em", textTransform:"uppercase", flexShrink:0 }}>📂 Browse Files</button>
                </div>
                <div ref={dragRef} onDragOver={function(e){e.preventDefault();if(dragRef.current)dragRef.current.classList.add("drag-over");}} onDragLeave={function(){if(dragRef.current)dragRef.current.classList.remove("drag-over");}} onDrop={onDrop} onClick={function(){if(fileRef.current)fileRef.current.click();}} style={{ border:"2px dashed", borderColor:stlFile?"#f97316":"#1f2937", borderRadius:12, padding:"28px 24px", textAlign:"center", cursor:"pointer", background:stlFile?"rgba(249,115,22,0.03)":"transparent", transition:"all .2s" }}>
                  <input ref={fileRef} type="file" accept=".stl" style={{ display:"none" }} onChange={function(e){if(e.target.files&&e.target.files[0])handleFile(e.target.files[0]);}}/>
                  {parsing&&<div><div className="pulse" style={{ fontSize:30, marginBottom:10 }}>⚙️</div><div style={{ fontSize:13, color:"#f97316" }}>Analysing your design...</div></div>}
                  {!parsing&&stlFile&&<div>
                    <div style={{ fontSize:36, marginBottom:8 }}>📦</div>
                    <div style={{ fontSize:14, color:"#f97316", fontWeight:500 }}>{stlFile.name}</div>
                    <div style={{ fontSize:11, color:"#4b5563", marginTop:3 }}>{(stlFile.size/1024).toFixed(1)} KB</div>
                    {stlStats&&checkBuildVolume(stlStats.dimensions).length>0&&<div style={{ marginTop:8, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:7, padding:"8px 12px" }}>
                      {checkBuildVolume(stlStats.dimensions).map(function(w,i){return <div key={i} style={{ fontSize:11, color:"#ef4444" }}>⚠️ {w}</div>;})}
                    </div>}
                    {stlStats&&getCx(stlStats.triangles).warn&&<div style={{ marginTop:8, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"8px 12px", fontSize:11, color:"#ef4444" }}>⚠️ Very high complexity ({stlStats.triangles.toLocaleString()} triangles) — slicing may take a while.</div>}
                    <button className="bh" onClick={function(e){e.stopPropagation();if(fileRef.current)fileRef.current.click();}} style={{ marginTop:8, background:"transparent", color:"#4b5563", border:"1px solid #1f2937", borderRadius:5, padding:"4px 12px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer" }}>Replace file</button>
                  </div>}
                  {!parsing&&!stlFile&&<div>
                    <div style={{ fontSize:44, marginBottom:10, opacity:0.3 }}>🖨️</div>
                    <div style={{ fontSize:14, color:"#4b5563", marginBottom:4 }}>Drag your STL file here</div>
                    <div style={{ fontSize:11, color:"#374151" }}>or use the Browse Files button above</div>
                  </div>}
                </div>
                {stlError&&<div style={{ background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"10px 12px", fontSize:11, color:"#ef4444", lineHeight:1.6, marginTop:8 }}>{stlError}</div>}
              </div>
            </Card>

            {stlStats&&<div className="fu">
              <STLPreview rawVertices={stlStats.rawVertices}/>
              <div className="g3" style={{ marginTop:10 }}>
                {(function(){var sc=getSzComp(stlStats.dimensions),cx=getCx(stlStats.triangles),th=stlStats.estimatedHours*form.quantity*0.85;
                  return[<InfoTile key="sz" e={sc.e} l="Size" v={sc.l} s={sc.s}/>,<InfoTile key="cx" e={cx.s} l="Complexity" v={cx.l} s="Based on geometry" c={cx.c}/>,<InfoTile key="t" e="⏱" l="Est. Print Time" v={fmtH(th)} s={fmtPlain(th)} c="#f97316"/>];
                })()}
              </div>
            </div>}

            <NavBtns onNext={function(){setStep(1);}} disabled={!form.teacherName||!form.email||!stlFile||parsing} label="Continue to print options"/>
          </div>}

          {/* Step 1 */}
          {step===1&&<div className="fu" style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <Card title="What are you printing?">
              <div><Lbl>Project name</Lbl><input value={form.projectName} placeholder='e.g. "Volcano model for Year 9"' onChange={function(e){setForm(function(f){return Object.assign({},f,{projectName:e.target.value});});}} style={baseInput}/></div>
              <div><Lbl>What's it for? (optional)</Lbl><textarea value={form.purpose} rows={2} placeholder="e.g. End-of-term science fair" onChange={function(e){setForm(function(f){return Object.assign({},f,{purpose:e.target.value});});}} style={Object.assign({},baseInput,{resize:"vertical",lineHeight:1.7})}/></div>
              <div className="g2s">
                <div>
                  <Lbl>How many copies?</Lbl>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <button className="bh" onClick={function(){setForm(function(f){return Object.assign({},f,{quantity:Math.max(1,f.quantity-1)});});}} style={{ width:36, height:36, border:"1px solid #111827", borderRadius:6, background:"#080d16", color:"#e2e8f0", fontSize:18, cursor:"pointer", fontFamily:"inherit" }}>-</button>
                    <div style={{ flex:1, textAlign:"center", fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, color:"#f97316" }}>{form.quantity}</div>
                    <button className="bh" onClick={function(){setForm(function(f){return Object.assign({},f,{quantity:Math.min(50,f.quantity+1)});});}} style={{ width:36, height:36, border:"1px solid #111827", borderRadius:6, background:"#080d16", color:"#e2e8f0", fontSize:18, cursor:"pointer", fontFamily:"inherit" }}>+</button>
                  </div>
                  {stlStats&&form.quantity>1&&<div style={{ fontSize:10, color:"#f97316", marginTop:6 }}>Total est: {fmtH(stlStats.estimatedHours*form.quantity*0.85)}</div>}
                </div>
                <div>
                  <Lbl>Needed by</Lbl>
                  <input type="date" value={form.dueDate} min={new Date().toISOString().split("T")[0]} onChange={function(e){setForm(function(f){return Object.assign({},f,{dueDate:e.target.value});});}} style={Object.assign({},baseInput,{colorScheme:"dark"})}/>
                  {DW&&<div style={{ fontSize:11, color:DW.t==="error"?"#ef4444":DW.t==="warn"?"#f59e0b":"#22c55e", marginTop:5, lineHeight:1.6 }}>{DW.t==="error"?"❌":DW.t==="warn"?"⚠️":"✅"} {DW.msg}</div>}
                </div>
              </div>
              {stlStats&&(function(){
                var readyEst=estimateReadyDate(requests,{stlStats:{estimatedHours:stlStats.estimatedHours},quantity:form.quantity});
                return <div style={{ background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.18)", borderRadius:8, padding:"10px 14px" }}>
                  <div style={{ fontSize:10, color:"#3b82f6", letterSpacing:"0.08em", marginBottom:3 }}>ESTIMATED READY DATE (based on current queue)</div>
                  <div style={{ fontSize:14, fontFamily:"'Syne',sans-serif", fontWeight:800, color:"#60a5fa" }}>{formatReadyDate(readyEst)}</div>
                </div>;
              })()}
            </Card>
            <Card title="Choose a material — not sure? Pick PLA">
              <div className="g2s" style={{ gap:10 }}>
                {MATS.map(function(m){var sel=form.material===m.id;return <div key={m.id} className="mc" onClick={function(){setForm(function(f){return Object.assign({},f,{material:m.id});});}} style={{ border:"2px solid "+(sel?m.color:"#111827"), borderRadius:10, padding:12, background:sel?m.color+"12":"#080d16", position:"relative" }}>
                  <div style={{ position:"absolute", top:8, right:8, fontSize:8, background:m.color+"33", color:m.color, borderRadius:4, padding:"2px 6px" }}>{m.tag}</div>
                  <div style={{ fontSize:20, marginBottom:4 }}>{m.emoji}</div>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:sel?m.color:"#e2e8f0", marginBottom:4 }}>{m.name}</div>
                  <div style={{ fontSize:10, color:"#4b5563", lineHeight:1.6 }}>{m.desc}</div>
                </div>;})}
              </div>
            </Card>
            <Card title="Colour preference">
              <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                {COLORS.map(function(c){var sel=form.color===c.name;return <div key={c.name} className="cs" onClick={function(){setForm(function(f){return Object.assign({},f,{color:c.name});});}} title={c.name} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:c.hex, border:"3px solid "+(sel?"#f97316":c.border?"#374151":"transparent"), boxShadow:sel?"0 0 12px rgba(249,115,22,0.5)":"none", transition:"all .15s" }}/>
                  <div style={{ fontSize:8, color:sel?"#f97316":"#374151" }}>{c.name}</div>
                </div>;})}
              </div>
            </Card>
            <Card title="Any special instructions?">
              <textarea value={form.notes} rows={3} placeholder="e.g. needs to be strong, fragile parts, specific finish..." onChange={function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});}} style={Object.assign({},baseInput,{resize:"vertical",lineHeight:1.7})}/>
            </Card>
            <NavBtns onBack={function(){setStep(0);}} onNext={function(){setStep(2);}} disabled={!form.projectName||!form.dueDate} label="Review my request"/>
          </div>}

          {/* Step 2 — Review */}
          {step===2&&<div className="fu" style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <Card title="Summary — does everything look right?">
              <div className="g2s" style={{ gap:10 }}>
                {[["Name",form.teacherName],["Email",form.email],["Department",form.department||"Not specified"],["Project",form.projectName],["Quantity","x"+form.quantity],["Due",form.dueDate?new Date(form.dueDate+"T00:00:00").toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long"}):"—"],["Material",form.material+" — "+form.color],["File",stlFile?stlFile.name:"—"],["Source URL",form.sourceUrl||"Not provided"]].map(function(pair){
                  return <div key={pair[0]} style={{ background:"#080d16", borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:10, color:"#374151", marginBottom:3 }}>{pair[0]}</div><div style={{ fontSize:12, color:"#9ca3af", wordBreak:"break-all" }}>{pair[1]}</div></div>;
                })}
              </div>
              {form.notes&&<div style={{ background:"#080d16", borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:10, color:"#374151", marginBottom:3 }}>Notes</div><div style={{ fontSize:12, color:"#6b7280", lineHeight:1.7 }}>{form.notes}</div></div>}
              {stlStats&&<div style={{ background:"rgba(249,115,22,0.06)", border:"1px solid rgba(249,115,22,0.12)", borderRadius:8, padding:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div><div style={{ fontSize:10, color:"#374151", marginBottom:2 }}>Estimated print time</div><div style={{ fontSize:20, fontFamily:"'Syne',sans-serif", fontWeight:900, color:"#f97316" }}>{fmtH(stlStats.estimatedHours*form.quantity*0.85)}</div></div>
                <div style={{ textAlign:"right" }}><div style={{ fontSize:10, color:"#374151", marginBottom:2 }}>Est. filament</div><div style={{ fontSize:12, color:"#6b7280" }}>{estWeight(stlStats,form.material,form.quantity).toFixed(0)}g</div></div>
              </div>}
            </Card>
            <div style={{ background:"rgba(34,197,94,0.06)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#22c55e" }}>
              ✉ After submitting, your email client will open with a confirmation message to send yourself.
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button className="bh" onClick={function(){setStep(1);}} style={{ flex:"0 0 auto", background:"transparent", color:"#4b5563", border:"1px solid #111827", borderRadius:8, padding:"12px 20px", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>← Edit</button>
              <button className="bh" onClick={function(){saveTemplate().then(function(){});handleSubmit();sendConfirmEmail(Object.assign({},form,{fileName:stlFile?stlFile.name:"",id:"new"}),estimateReadyDate(requests,{stlStats:stlStats,quantity:form.quantity}));}} style={{ flex:1, background:"linear-gradient(135deg,#f97316,#c2410c)", color:"#fff", border:"none", borderRadius:8, padding:"14px 0", fontFamily:"inherit", fontSize:13, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", boxShadow:"0 0 28px rgba(249,115,22,0.35)", animation:"glow 2s infinite" }}>🚀 Submit Print Request</button>
            </div>
          </div>}
        </div>}
      </div>}

      {/* ── QUEUE ── */}
      {view==="log"&&admin&&<div className="fu">
        <div className="g4" style={{ marginBottom:20 }}>
          <StatCard emoji="📋" value={""+requests.length} label="Total" color="#4b5563"/>
          <StatCard emoji="⏳" value={""+qs.q} label="Queued" color="#f59e0b"/>
          <StatCard emoji="🖨️" value={""+qs.p} label="Printing" color="#3b82f6"/>
          <StatCard emoji="✅" value={""+qs.d} label="Done" color="#22c55e"/>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800 }}>Print Queue</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {["All"].concat(STATUSES).map(function(s){var active=filterStatus===s,col=SC[s]||"#f97316";return <button key={s} className="bh" onClick={function(){setFilterStatus(s);}} style={{ background:active?col:"transparent", color:active?"#fff":"#4b5563", border:"1px solid "+(active?col:"#111827"), borderRadius:5, padding:"5px 11px", fontFamily:"inherit", fontSize:9, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase" }}>{s}</button>;})}
          </div>
        </div>
        {loading?<div className="pulse" style={{ color:"#f97316", fontSize:12, padding:"50px 0", textAlign:"center" }}>Loading...</div>
        :filtered.length===0?<div style={{ textAlign:"center", padding:"60px 0" }}><div style={{ fontSize:44, marginBottom:12, opacity:0.15 }}>🖨️</div><div style={{ fontSize:14, color:"#1f2937" }}>No {filterStatus!=="All"?filterStatus.toLowerCase():""} requests yet</div></div>
        :<div className="det">
          <div style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
            <div className="qhead" style={{ borderBottom:"1px solid #111827" }}>
              <div/>{["Project","Teacher","Due","Est. Time","Qty","Status"].map(function(h){return <div key={h} style={{ fontSize:8, color:"#1f2937", letterSpacing:"0.12em", textTransform:"uppercase" }}>{h}</div>;})}
            </div>
            {filtered.map(function(req,i){
              var due=req.dueDate?new Date(req.dueDate+"T00:00:00"):null;
              var dl=due?Math.ceil((due-Date.now())/86400000):null;
              var over=dl!==null&&dl<0&&!["Done","Cancelled"].includes(req.status);
              var soon=dl!==null&&dl<=2&&dl>=0&&!["Done","Cancelled"].includes(req.status);
              var isSel=selReq&&selReq.id===req.id;
              return <div key={req.id} className="rh qrow" onClick={function(){setSelReq(isSel?null:req);}} style={{ borderBottom:i<filtered.length-1?"1px solid #080d16":"none", background:isSel?"rgba(249,115,22,0.04)":"transparent" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                  <button className="bh" onClick={function(e){e.stopPropagation();reorder(req.id,-1);}} style={{ background:"none", border:"none", color:"#1f2937", cursor:"pointer", fontSize:10, lineHeight:1 }}>▲</button>
                  <button className="bh" onClick={function(e){e.stopPropagation();reorder(req.id,1);}} style={{ background:"none", border:"none", color:"#1f2937", cursor:"pointer", fontSize:10, lineHeight:1 }}>▼</button>
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{req.projectName}</span>
                    {over&&<span style={{ fontSize:8, background:"rgba(239,68,68,0.15)", color:"#ef4444", borderRadius:3, padding:"2px 5px" }}>OVERDUE</span>}
                    {soon&&<span style={{ fontSize:8, background:"rgba(245,158,11,0.15)", color:"#f59e0b", borderRadius:3, padding:"2px 5px" }}>DUE SOON</span>}
                  </div>
                  <div style={{ fontSize:9, color:"#1f2937", marginTop:1 }}>{req.fileName}</div>
                </div>
                <div className="hmob"><div style={{ fontSize:12, color:"#6b7280" }}>{req.teacherName}</div><div style={{ fontSize:9, color:"#1f2937" }}>{req.department||req.email}</div></div>
                <div className="hmob" style={{ fontSize:11, color:over?"#ef4444":soon?"#f59e0b":"#4b5563" }}>{due?due.toLocaleDateString("en-AU",{day:"numeric",month:"short"}):"—"}</div>
                <div className="hmob" style={{ fontSize:11, color:req.stlStats?"#f97316":"#1f2937" }}>{req.stlStats?fmtH(req.stlStats.estimatedHours*req.quantity*0.85):"—"}</div>
                <div className="hmob" style={{ fontSize:11, color:"#4b5563" }}>x{req.quantity}</div>
                <div><span style={{ background:SC[req.status]+"20", color:SC[req.status], border:"1px solid "+SC[req.status]+"40", borderRadius:4, padding:"3px 8px", fontSize:8, letterSpacing:"0.07em", textTransform:"uppercase" }}>{req.status}</span></div>
              </div>;
            })}
          </div>

          {selReq&&<div className="fu" style={{ background:"#0d1220", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
            <div style={{ borderBottom:"1px solid #111827", padding:"12px 15px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:12 }}>REQUEST DETAIL</span>
              <button onClick={function(){setSelReq(null);}} style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
            </div>
            <div style={{ padding:16, display:"flex", flexDirection:"column", gap:13 }}>
              <div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:15, fontWeight:800, color:"#fff" }}>{selReq.projectName}</div>
                {selReq.purpose&&<div style={{ fontSize:11, color:"#4b5563", marginTop:3, lineHeight:1.6 }}>{selReq.purpose}</div>}
                <div style={{ fontSize:9, color:"#1f2937", marginTop:3 }}>Submitted {new Date(selReq.submittedAt).toLocaleString()}</div>
              </div>

              {selReq.status==="Printing"&&selReq.printStartedAt&&selReq.stlStats&&<div style={{ background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.18)", borderRadius:10, padding:12 }}>
                <div style={{ fontSize:9, color:"#3b82f6", letterSpacing:"0.1em", marginBottom:4, textAlign:"center" }}>LIVE COUNTDOWN</div>
                <Countdown startedAt={selReq.printStartedAt} estimatedHours={selReq.stlStats.estimatedHours} quantity={selReq.quantity}/>
              </div>}

              <div className="g2s" style={{ gap:7 }}>
                {[["Teacher",selReq.teacherName],["Email",selReq.email],["Dept.",selReq.department||"—"],["Due",selReq.dueDate?new Date(selReq.dueDate+"T00:00:00").toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short"}):"—"],["Material",selReq.material],["Colour",selReq.color],["Qty","x"+selReq.quantity],["File",selReq.fileName]].map(function(pair){
                  return <div key={pair[0]} style={{ background:"#080d16", borderRadius:7, padding:"8px 10px" }}><div style={{ fontSize:9, color:"#1f2937", marginBottom:3 }}>{pair[0]}</div><div style={{ fontSize:11, color:"#6b7280", wordBreak:"break-all" }}>{pair[1]}</div></div>;
                })}
              </div>

              {selReq.sourceUrl&&<div style={{ background:"#080d16", borderRadius:7, padding:"8px 10px" }}><div style={{ fontSize:9, color:"#1f2937", marginBottom:3 }}>Source URL</div><a href={selReq.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#3b82f6", wordBreak:"break-all" }}>{selReq.sourceUrl}</a></div>}

              {selReq.notes&&<div style={{ background:"#080d16", border:"1px solid #111827", borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:9, color:"#1f2937", marginBottom:4 }}>NOTES</div><div style={{ fontSize:11, color:"#4b5563", lineHeight:1.7 }}>{selReq.notes}</div></div>}

              {selReq.stlStats&&<div style={{ background:"rgba(249,115,22,0.05)", border:"1px solid rgba(249,115,22,0.12)", borderRadius:8, padding:12 }}>
                <div style={{ fontSize:9, color:"#f97316", letterSpacing:"0.1em", marginBottom:8 }}>GEOMETRY & COST</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {(function(){
                    var wG=estWeight(selReq.stlStats,selReq.material,selReq.quantity);
                    var filStr=selReq.filamentUsedG?(selReq.filamentUsedG.toFixed(0)+"g"):("~"+wG.toFixed(0)+"g (est.)");
                    var costStr=selReq.estimatedCostAUD?fmtAUD(selReq.estimatedCostAUD):("~"+fmtAUD(estCost(wG,24.99))+" (est.)");
                    var dims=selReq.stlStats.dimensions;
                    var dimStr=dims.x.toFixed(0)+"x"+dims.y.toFixed(0)+"x"+dims.z.toFixed(0)+" mm";
                    var bvWarns=checkBuildVolume(dims);
                    return [["Per piece",fmtH(selReq.stlStats.estimatedHours),true],["Total x"+selReq.quantity,fmtH(selReq.stlStats.estimatedHours*selReq.quantity*0.85),true],["Filament used",filStr,false],["Est. cost",costStr,false],["W x D x H",dimStr,false]].concat(bvWarns.map(function(w){return["⚠️",w,"warn"];})).map(function(row){
                      return <div key={row[0]} style={{ display:"flex", justifyContent:"space-between" }}><span style={{ fontSize:11, color:row[2]==="warn"?"#ef4444":"#374151" }}>{row[0]}</span><span style={{ fontSize:12, color:row[2]===true?"#f97316":row[2]==="warn"?"#ef4444":"#9ca3af", fontWeight:row[2]===true?500:400 }}>{row[1]}</span></div>;
                    });
                  })()}
                </div>
              </div>}

              {selReq.status==="Done"&&<div style={{ display:"flex", gap:8 }}>
                <button onClick={function(){generateICS(selReq,new Date());}} className="bh" style={{ flex:1, background:"rgba(34,197,94,0.08)", color:"#22c55e", border:"1px solid rgba(34,197,94,0.25)", borderRadius:7, padding:"9px 0", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase" }}>📅 Add to Calendar</button>
                <div style={{ flex:1, background:"#080d16", border:"1px solid #111827", borderRadius:7, padding:"9px", textAlign:"center" }}>
                  <img src={generateQR("Print "+selReq.projectName+" is ready! Collect from Print Lab.")} alt="QR" style={{ width:60, height:60, borderRadius:4 }}/>
                  <div style={{ fontSize:8, color:"#374151", marginTop:3 }}>QR for pickup</div>
                </div>
              </div>}

              {selReq.log&&selReq.log.length>0&&<div style={{ background:"#080d16", border:"1px solid #111827", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontSize:9, color:"#1f2937", letterSpacing:"0.1em", marginBottom:6 }}>ACTIVITY</div>
                {selReq.log.map(function(l,i){return <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}><span style={{ fontSize:10, color:"#374151" }}>{l.msg}{l.by?" — "+l.by:""}</span><span style={{ fontSize:9, color:"#1f2937" }}>{new Date(l.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span></div>;})}
              </div>}

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {selReq.status==="Queued"&&(!confStart
                  ?<button className="bh" onClick={function(){setConfStart(true);}} style={{ background:"linear-gradient(135deg,#3b82f6,#1d4ed8)", color:"#fff", border:"none", borderRadius:8, padding:"12px 0", fontFamily:"inherit", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase", boxShadow:"0 0 22px rgba(59,130,246,0.3)" }}>Start Print + Notify Teacher</button>
                  :<div style={{ background:"rgba(59,130,246,0.07)", border:"1px solid rgba(59,130,246,0.25)", borderRadius:8, padding:13 }}>
                    <div style={{ fontSize:11, color:"#60a5fa", marginBottom:8, lineHeight:1.7 }}>Opens your email client for <strong style={{ color:"#fff" }}>{selReq.email}</strong></div>
                    <div style={{ marginBottom:10 }}><Lbl>Note to teacher (optional)</Lbl><textarea value={adminNote} onChange={function(e){setAdminNote(e.target.value);}} rows={2} placeholder="e.g. Starting after 2pm today..." style={Object.assign({},smallInput,{resize:"vertical",lineHeight:1.6})}/></div>
                    <div style={{ display:"flex", gap:8 }}>
                      <button className="bh" onClick={function(){startPrint(selReq);}} style={{ flex:1, background:"#3b82f6", color:"#fff", border:"none", borderRadius:7, padding:"10px 0", fontFamily:"inherit", fontSize:10, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Confirm & Send</button>
                      <button className="bh" onClick={function(){setConfStart(false);setAdminNote("");}} style={{ flex:1, background:"transparent", color:"#4b5563", border:"1px solid #111827", borderRadius:7, padding:"10px 0", fontFamily:"inherit", fontSize:10, cursor:"pointer" }}>Cancel</button>
                    </div>
                  </div>
                )}
                {selReq.status==="Printing"&&<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <div style={{ marginBottom:4 }}><Lbl>Note to teacher (optional)</Lbl><textarea value={adminNote} onChange={function(e){setAdminNote(e.target.value);}} rows={2} placeholder="e.g. Slight delay..." style={Object.assign({},smallInput,{resize:"vertical",lineHeight:1.6})}/></div>
                  <button className="bh" onClick={function(){markDone(selReq);}} style={{ background:"linear-gradient(135deg,#22c55e,#15803d)", color:"#fff", border:"none", borderRadius:8, padding:"12px 0", fontFamily:"inherit", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase", boxShadow:"0 0 22px rgba(34,197,94,0.25)" }}>Mark Done + Send Pickup Email</button>
                  <button className="bh" onClick={function(){sendStartEmail(selReq,admin,adminNote);}} style={{ background:"transparent", color:"#3b82f6", border:"1px solid rgba(59,130,246,0.25)", borderRadius:7, padding:"9px 0", fontFamily:"inherit", fontSize:10, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Resend Start Notification</button>
                </div>}
                <div>
                  <div style={{ fontSize:9, color:"#1f2937", letterSpacing:"0.1em", marginBottom:6 }}>MANUAL STATUS</div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {STATUSES.map(function(s){var active=selReq.status===s;return <button key={s} className="bh" onClick={function(){updateStatus(selReq.id,s);}} style={{ background:active?SC[s]:"transparent", color:active?"#fff":SC[s], border:"1px solid "+SC[s], borderRadius:5, padding:"4px 10px", fontFamily:"inherit", fontSize:9, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase" }}>{s}</button>;})}
                  </div>
                </div>
                <button className="bh" onClick={function(){deleteReq(selReq.id);}} style={{ background:"rgba(239,68,68,0.06)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"8px 0", fontFamily:"inherit", fontSize:9, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Delete Request</button>
              </div>
            </div>
          </div>}
        </div>}
      </div>}
    </div>
  </div>;
}
