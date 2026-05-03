import { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

// ─── Storage ──────────────────────────────────────────────────────────────────
var RK = "pl_reqs_v7";
var AK = "pl_admins_v2";
var IK = "pl_inv_v2";
var SK = "pl_settings_v1";
var TK = "pl_templates_v1";
var LIK = "pl_laser_inv_v1";

// ─── Storage abstraction (localStorage now, Supabase when configured) ──────────
var _sb = null; // Supabase client, set by initSupabase()

function initSupabase(url, key) {
  if (!url || !key) { _sb = null; return false; }
  try {
    _sb = window.supabase ? window.supabase.createClient(url, key) : null;
    return !!_sb;
  } catch(e) { _sb = null; return false; }
}

async function sget(k) {
  if (_sb) {
    try {
      var r = await _sb.from("printlab_store").select("value").eq("key", k).single();
      if (r.data) return JSON.parse(r.data.value);
    } catch(e) {}
  }
  try { var r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch(e) { return null; }
}
async function sset(k, v) {
  var str = JSON.stringify(v);
  if (_sb) {
    try { await _sb.from("printlab_store").upsert({ key: k, value: str, updated_at: new Date().toISOString() }); } catch(e) {}
  }
  try { await window.storage.set(k, str); } catch(e) {}
}

// ─── Push notification helpers ────────────────────────────────────────────────
var NOTIF_PERM_KEY = "pl_notif_perm_v1";
var NOTIF_STATUS_KEY = "pl_notif_statuses_v1";

async function requestNotifPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  var perm = await Notification.requestPermission();
  return perm;
}

function fireNotif(title, body, tag) {
  if (Notification.permission !== "granted") return;
  try { new Notification(title, { body: body, tag: tag, icon: "/macc-printlab/icon-192.png" }); } catch(e) {}
}

function checkStatusChanges(requests, email) {
  if (!email || Notification.permission !== "granted") return;
  var prev = {};
  try { prev = JSON.parse(localStorage.getItem(NOTIF_STATUS_KEY) || "{}"); } catch(e) {}
  var next = {};
  var mine = requests.filter(function(r) { return r.email && r.email.toLowerCase() === email.toLowerCase(); });
  mine.forEach(function(r) {
    next[r.id] = r.status;
    if (prev[r.id] && prev[r.id] !== r.status) {
      var msgs = {
        Queued: "Your request has been approved and is in the queue.",
        Printing: "Your print has started! Check the countdown in My Status.",
        Done: "Your print is ready for pickup!",
        Failed: "Your print encountered an issue — check My Status for details.",
        Cancelled: "Your request was cancelled — see My Status for the reason."
      };
      var msg = msgs[r.status];
      if (msg) fireNotif("Print Lab — " + r.projectName, msg, r.id);
    }
  });
  try { localStorage.setItem(NOTIF_STATUS_KEY, JSON.stringify(next)); } catch(e) {}
}
async function loadReqs() { return (await sget(RK)) || []; }
async function saveReqs(r) { await sset(RK, r); }
async function loadInv() { return (await sget(IK)) || buildDefaultInv(); }
async function saveInv(i) { await sset(IK, i); }
async function loadSettings() { return (await sget(SK)) || { printerIp: "", printerCode: "", printerModel: "Bambu X1C", darkMode: true }; }
async function saveSettings(s) { await sset(SK, s); }
async function loadTemplates() { return (await sget(TK)) || []; }
async function saveTemplates(t) { await sset(TK, t); }
async function loadLaserInv() { return (await sget(LIK)) || buildDefaultLaserInv(); }
async function saveLaserInv(i) { await sset(LIK, i); }

// ─── Constants ────────────────────────────────────────────────────────────────
var SPOOL_G = 1000;
var LOW_G = 250;
var CRIT_G = 100;
var DENSITIES = { PLA: 1.24, PETG: 1.27, ABS: 1.05, TPU: 1.21 };
var DEPARTMENTS = ["TAS", "Mathematics", "English", "Science", "CAPA", "HSIE", "PDHPE", "Modern Languages", "Other"];
var STATUSES = ["Pending", "Queued", "Printing", "Done", "Failed", "Cancelled"];
var SC = { Pending: "#94a3b8", Queued: "#f59e0b", Printing: "#3b82f6", Done: "#22c55e", Failed: "#ef4444", Cancelled: "#64748b" };
var CHART_COLORS = ["#f97316","#3b82f6","#22c55e","#a855f7","#ec4899","#f59e0b","#06b6d4","#84cc16"];

// ─── H2D Laser / Cutting Constants ───────────────────────────────────────────
var LASER_COLOR = "#a855f7";
var LASER_JOB_TYPES = [
  { id:"Engrave",       emoji:"✏️",  name:"Engrave",       desc:"Burn a design into the surface. Does not cut through.",      needsLaser:true,  needsBlade:false },
  { id:"Cut",           emoji:"✂️",  name:"Cut",           desc:"Cut through the material along a path.",                    needsLaser:true,  needsBlade:false },
  { id:"Engrave & Cut", emoji:"🎨",  name:"Engrave & Cut", desc:"Engrave a design then cut the shape out in one job.",        needsLaser:true,  needsBlade:false },
  { id:"Vinyl Cut",     emoji:"🔪",  name:"Vinyl Cut",     desc:"Precision blade cutting for vinyl, stickers, card, paper.",  needsLaser:false, needsBlade:true  },
  { id:"Pen Draw",      emoji:"🖊️",  name:"Pen Draw",      desc:"Technical drawing or plotting with a pen attachment.",       needsLaser:false, needsBlade:false }
];
// H2D 40W laser material limits — basswood 15mm is the official Bambu Lab published spec.
// Other material limits are practical maximums for 40W diode lasers on these materials.
var LASER_MATERIALS = [
  { id:"wood",    name:"Wood / Timber",  emoji:"🪵", desc:"Basswood, pine, MDF, plywood, balsa, bamboo. 15mm is the official Bambu H2D 40W spec for basswood plywood.", maxMm40W:15, canEngrave:true,  canCut:true,  bladeOk:false },
  { id:"leather", name:"Leather",        emoji:"🟤", desc:"Natural or vegetable-tanned leather. Synthetic leather may produce toxic fumes — check with admin first.", maxMm40W:3,  canEngrave:true,  canCut:true,  bladeOk:true  },
  { id:"acrylic", name:"Dark Acrylic",   emoji:"⬛", desc:"Dark or colour-cast acrylic only. Clear or transparent acrylic reflects the laser and cannot be processed safely.", maxMm40W:6, canEngrave:true, canCut:true, bladeOk:false },
  { id:"rubber",  name:"Rubber",         emoji:"⚫", desc:"Rubber stamp material, craft foam. Note: some rubbers produce toxic fumes — confirm material type with admin.", maxMm40W:5,  canEngrave:true,  canCut:true,  bladeOk:false },
  { id:"metal",   name:"Sheet Metal",    emoji:"🔩", desc:"Thin sheet metal and anodised aluminium — surface engraving/marking only. Laser cannot cut metal.", maxMm40W:0, canEngrave:true, canCut:false, bladeOk:false },
  { id:"stone",   name:"Stone / Slate",  emoji:"🪨", desc:"Slate, tile, marble, granite — surface engraving only. Creates a frosted/contrasting mark.",maxMm40W:0,  canEngrave:true,  canCut:false, bladeOk:false },
  { id:"vinyl",   name:"Vinyl / Paper",  emoji:"🎨", desc:"Vinyl, paper, cardstock, fabric — blade cutting only (max 0.5mm). Use for stickers, decals, stencils, and apparel graphics.", maxMm40W:0, canEngrave:false, canCut:true, bladeOk:true }
];
// H2D working areas (mm)
var H2D_AREA = { laser10W:{ w:310, h:270 }, laser40W:{ w:310, h:250 }, blade:{ w:300, h:285 }, pen:{ w:300, h:255 } };

function getLaserWarnings(form) {
  var warnings = [];
  var mat = null;
  for (var i = 0; i < LASER_MATERIALS.length; i++) { if (LASER_MATERIALS[i].id === form.laserMaterial) { mat = LASER_MATERIALS[i]; break; } }
  if (!mat) return warnings;
  var thick = parseFloat(form.thickness) || 0;
  var jt = form.jobType;
  // Blade-only material attempted with laser engrave
  if (mat.bladeOk && !mat.canEngrave && (jt === "Engrave" || jt === "Engrave & Cut")) {
    warnings.push({ type:"error", msg: mat.name + " cannot be engraved with laser — use Vinyl Cut instead." });
  }
  // Cannot cut metal/stone/engraving-only materials
  if (!mat.canCut && (jt === "Cut" || jt === "Engrave & Cut")) {
    warnings.push({ type:"error", msg: mat.name + " cannot be cut — laser engraving only for this material." });
  }
  // 40W thickness check
  if (thick > 0 && (jt === "Cut" || jt === "Engrave & Cut") && mat.canCut) {
    if (mat.maxMm40W > 0 && thick > mat.maxMm40W) {
      warnings.push({ type:"error", msg: "40W laser cannot cut " + thick + "mm of " + mat.name + " (max " + mat.maxMm40W + "mm). Please reduce thickness." });
    } else if (mat.maxMm40W > 0 && thick > mat.maxMm40W * 0.75) {
      warnings.push({ type:"warn", msg: "Approaching cut limit for " + mat.name + " (" + mat.maxMm40W + "mm max). Multiple passes may be needed." });
    }
  }
  // Vinyl cut material mismatch
  if (jt === "Vinyl Cut" && !mat.bladeOk && mat.id !== "vinyl") {
    warnings.push({ type:"warn", msg: mat.name + " is not recommended for vinyl blade cutting." });
  }
  return warnings;
}

function getLaserEstTime(form) {
  if (!form.designWidth || !form.designHeight) return null;
  var w = parseFloat(form.designWidth) || 100;
  var h = parseFloat(form.designHeight) || 100;
  var area = w * h;
  var speed = 800; // 40W
  var jt = form.jobType;
  var factor = jt === "Engrave" ? 1.0 : jt === "Cut" ? 0.4 : jt === "Engrave & Cut" ? 1.5 : 0.3;
  var minutes = Math.max(5, Math.round((area / (speed * 60)) * 60 * factor * (parseFloat(form.quantity) || 1)));
  if (minutes < 60) return minutes + " min";
  var hrs = Math.floor(minutes / 60);
  var mins = minutes % 60;
  return hrs + "h " + (mins > 0 ? mins + "m" : "");
}


// Bambu X1C build volume (mm)
var BUILD_VOL = { x: 256, y: 256, z: 256 };

var DEFAULT_ADMINS = [
  { email: "robertw@macc.nsw.edu.au", name: "Robert W.", role: "Admin", password: "Orbit#4821", mustReset: true },
  { email: "thomas.rodriguez@macc.nsw.edu.au", name: "Thomas Rodriguez", role: "Head of STEM", password: "Prism#7364", mustReset: true }
];
async function loadAdmins() { var s = await sget(AK); if (!s) { await sset(AK, DEFAULT_ADMINS); return DEFAULT_ADMINS; } return s; }
async function saveAdmins(a) { await sset(AK, a); }

// Official Bambu Lab filament catalog
// Hex codes from Bambu Lab published hex code tables
// Prices in AUD from au.store.bambulab.com
var BAMBU = [
  // PLA Basic - 30 colours (official Bambu Lab hex codes)
  { id:"plab-jade-white",       type:"PLA Basic", material:"PLA",  color:"Jade White",       hex:"#FFFFFF", price:27.99, density:1.24 },
  { id:"plab-beige",            type:"PLA Basic", material:"PLA",  color:"Beige",            hex:"#F7E6DE", price:27.99, density:1.24 },
  { id:"plab-light-gray",       type:"PLA Basic", material:"PLA",  color:"Light Gray",       hex:"#D1D3D5", price:27.99, density:1.24 },
  { id:"plab-silver",           type:"PLA Basic", material:"PLA",  color:"Silver",           hex:"#A6A9AA", price:27.99, density:1.24 },
  { id:"plab-gray",             type:"PLA Basic", material:"PLA",  color:"Gray",             hex:"#8E9089", price:27.99, density:1.24 },
  { id:"plab-dark-gray",        type:"PLA Basic", material:"PLA",  color:"Dark Gray",        hex:"#545454", price:27.99, density:1.24 },
  { id:"plab-blue-grey",        type:"PLA Basic", material:"PLA",  color:"Blue Grey",        hex:"#5B6579", price:27.99, density:1.24 },
  { id:"plab-black",            type:"PLA Basic", material:"PLA",  color:"Black",            hex:"#000000", price:27.99, density:1.24 },
  { id:"plab-red",              type:"PLA Basic", material:"PLA",  color:"Red",              hex:"#C12E1F", price:27.99, density:1.24 },
  { id:"plab-maroon-red",       type:"PLA Basic", material:"PLA",  color:"Maroon Red",       hex:"#9D2235", price:27.99, density:1.24 },
  { id:"plab-hot-pink",         type:"PLA Basic", material:"PLA",  color:"Hot Pink",         hex:"#F5547C", price:27.99, density:1.24 },
  { id:"plab-pink",             type:"PLA Basic", material:"PLA",  color:"Pink",             hex:"#F55A74", price:27.99, density:1.24 },
  { id:"plab-magenta",          type:"PLA Basic", material:"PLA",  color:"Magenta",          hex:"#EC008C", price:27.99, density:1.24 },
  { id:"plab-indigo-purple",    type:"PLA Basic", material:"PLA",  color:"Indigo Purple",    hex:"#482960", price:27.99, density:1.24 },
  { id:"plab-purple",           type:"PLA Basic", material:"PLA",  color:"Purple",           hex:"#5E43B7", price:27.99, density:1.24 },
  { id:"plab-orange",           type:"PLA Basic", material:"PLA",  color:"Orange",           hex:"#FF6A13", price:27.99, density:1.24 },
  { id:"plab-pumpkin-orange",   type:"PLA Basic", material:"PLA",  color:"Pumpkin Orange",   hex:"#FF9016", price:27.99, density:1.24 },
  { id:"plab-gold",             type:"PLA Basic", material:"PLA",  color:"Gold",             hex:"#E4BD68", price:27.99, density:1.24 },
  { id:"plab-bronze",           type:"PLA Basic", material:"PLA",  color:"Bronze",           hex:"#847D48", price:27.99, density:1.24 },
  { id:"plab-yellow",           type:"PLA Basic", material:"PLA",  color:"Yellow",           hex:"#F4EE2A", price:27.99, density:1.24 },
  { id:"plab-sunflower-yellow", type:"PLA Basic", material:"PLA",  color:"Sunflower Yellow", hex:"#FEC600", price:27.99, density:1.24 },
  { id:"plab-bright-green",     type:"PLA Basic", material:"PLA",  color:"Bright Green",     hex:"#BECF00", price:27.99, density:1.24 },
  { id:"plab-bambu-green",      type:"PLA Basic", material:"PLA",  color:"Bambu Green",      hex:"#00AE42", price:27.99, density:1.24 },
  { id:"plab-mistletoe-green",  type:"PLA Basic", material:"PLA",  color:"Mistletoe Green",  hex:"#3F8E43", price:27.99, density:1.24 },
  { id:"plab-cyan",             type:"PLA Basic", material:"PLA",  color:"Cyan",             hex:"#0086D6", price:27.99, density:1.24 },
  { id:"plab-turquoise",        type:"PLA Basic", material:"PLA",  color:"Turquoise",        hex:"#00B1B7", price:27.99, density:1.24 },
  { id:"plab-cobalt-blue",      type:"PLA Basic", material:"PLA",  color:"Cobalt Blue",      hex:"#0056B8", price:27.99, density:1.24 },
  { id:"plab-blue",             type:"PLA Basic", material:"PLA",  color:"Blue",             hex:"#0A2989", price:27.99, density:1.24 },
  { id:"plab-cocoa-brown",      type:"PLA Basic", material:"PLA",  color:"Cocoa Brown",      hex:"#6F5034", price:27.99, density:1.24 },
  { id:"plab-brown",            type:"PLA Basic", material:"PLA",  color:"Brown",            hex:"#9D432C", price:27.99, density:1.24 },
  // PLA Matte - 25 colours (official Bambu Lab hex codes)
  { id:"plam-ivory-white",      type:"PLA Matte", material:"PLA",  color:"Ivory White",      hex:"#FFFFFF", price:29.99, density:1.24 },
  { id:"plam-bone-white",       type:"PLA Matte", material:"PLA",  color:"Bone White",       hex:"#CBC6B8", price:29.99, density:1.24 },
  { id:"plam-desert-tan",       type:"PLA Matte", material:"PLA",  color:"Desert Tan",       hex:"#E8DBB7", price:29.99, density:1.24 },
  { id:"plam-latte-brown",      type:"PLA Matte", material:"PLA",  color:"Latte Brown",      hex:"#D3B7A7", price:29.99, density:1.24 },
  { id:"plam-caramel",          type:"PLA Matte", material:"PLA",  color:"Caramel",          hex:"#AE835B", price:29.99, density:1.24 },
  { id:"plam-terracotta",       type:"PLA Matte", material:"PLA",  color:"Terracotta",       hex:"#B15533", price:29.99, density:1.24 },
  { id:"plam-dark-brown",       type:"PLA Matte", material:"PLA",  color:"Dark Brown",       hex:"#7D6556", price:29.99, density:1.24 },
  { id:"plam-dark-chocolate",   type:"PLA Matte", material:"PLA",  color:"Dark Chocolate",   hex:"#4D3324", price:29.99, density:1.24 },
  { id:"plam-lilac-purple",     type:"PLA Matte", material:"PLA",  color:"Lilac Purple",     hex:"#AE96D4", price:29.99, density:1.24 },
  { id:"plam-sakura-pink",      type:"PLA Matte", material:"PLA",  color:"Sakura Pink",      hex:"#E8AFCF", price:29.99, density:1.24 },
  { id:"plam-mandarin-orange",  type:"PLA Matte", material:"PLA",  color:"Mandarin Orange",  hex:"#F99963", price:29.99, density:1.24 },
  { id:"plam-lemon-yellow",     type:"PLA Matte", material:"PLA",  color:"Lemon Yellow",     hex:"#F7D959", price:29.99, density:1.24 },
  { id:"plam-plum",             type:"PLA Matte", material:"PLA",  color:"Plum",             hex:"#950051", price:29.99, density:1.24 },
  { id:"plam-scarlet-red",      type:"PLA Matte", material:"PLA",  color:"Scarlet Red",      hex:"#DE4343", price:29.99, density:1.24 },
  { id:"plam-dark-red",         type:"PLA Matte", material:"PLA",  color:"Dark Red",         hex:"#BB3D43", price:29.99, density:1.24 },
  { id:"plam-dark-green",       type:"PLA Matte", material:"PLA",  color:"Dark Green",       hex:"#68724D", price:29.99, density:1.24 },
  { id:"plam-grass-green",      type:"PLA Matte", material:"PLA",  color:"Grass Green",      hex:"#61C680", price:29.99, density:1.24 },
  { id:"plam-apple-green",      type:"PLA Matte", material:"PLA",  color:"Apple Green",      hex:"#C2E189", price:29.99, density:1.24 },
  { id:"plam-ice-blue",         type:"PLA Matte", material:"PLA",  color:"Ice Blue",         hex:"#A3D8E1", price:29.99, density:1.24 },
  { id:"plam-sky-blue",         type:"PLA Matte", material:"PLA",  color:"Sky Blue",         hex:"#56B7E6", price:29.99, density:1.24 },
  { id:"plam-marine-blue",      type:"PLA Matte", material:"PLA",  color:"Marine Blue",      hex:"#0078BF", price:29.99, density:1.24 },
  { id:"plam-dark-blue",        type:"PLA Matte", material:"PLA",  color:"Dark Blue",        hex:"#042F56", price:29.99, density:1.24 },
  { id:"plam-ash-gray",         type:"PLA Matte", material:"PLA",  color:"Ash Gray",         hex:"#9B9EA0", price:29.99, density:1.24 },
  { id:"plam-nardo-gray",       type:"PLA Matte", material:"PLA",  color:"Nardo Gray",       hex:"#757575", price:29.99, density:1.24 },
  { id:"plam-charcoal",         type:"PLA Matte", material:"PLA",  color:"Charcoal",         hex:"#000000", price:29.99, density:1.24 },
  // PLA Silk
  { id:"silk-gold",         type:"PLA Silk", material:"PLA", color:"Gold",         hex:"#E4BD68", price:32.99, density:1.24 },
  { id:"silk-silver",       type:"PLA Silk", material:"PLA", color:"Silver",       hex:"#A6A9AA", price:32.99, density:1.24 },
  { id:"silk-copper",       type:"PLA Silk", material:"PLA", color:"Copper",       hex:"#B87333", price:32.99, density:1.24 },
  { id:"silk-galaxy-black", type:"PLA Silk", material:"PLA", color:"Galaxy Black", hex:"#1A1A2E", price:32.99, density:1.24 },
  // PETG Basic (official Bambu Lab hex codes)
  { id:"petg-white",       type:"PETG Basic", material:"PETG", color:"White",       hex:"#FFFFFF", price:29.99, density:1.27 },
  { id:"petg-black",       type:"PETG Basic", material:"PETG", color:"Black",       hex:"#000000", price:29.99, density:1.27 },
  { id:"petg-gray",        type:"PETG Basic", material:"PETG", color:"Grey",        hex:"#8E9089", price:29.99, density:1.27 },
  { id:"petg-red",         type:"PETG Basic", material:"PETG", color:"Red",         hex:"#C12E1F", price:29.99, density:1.27 },
  { id:"petg-blue",        type:"PETG Basic", material:"PETG", color:"Blue",        hex:"#0A2989", price:29.99, density:1.27 },
  { id:"petg-blue-grey",   type:"PETG Basic", material:"PETG", color:"Blue Grey",   hex:"#5B6579", price:29.99, density:1.27 },
  { id:"petg-orange",      type:"PETG Basic", material:"PETG", color:"Orange",      hex:"#FF6A13", price:29.99, density:1.27 },
  { id:"petg-lake-blue",   type:"PETG Basic", material:"PETG", color:"Lake Blue",   hex:"#0086D6", price:29.99, density:1.27 },
  { id:"petg-yellow",      type:"PETG Basic", material:"PETG", color:"Yellow",      hex:"#F4EE2A", price:29.99, density:1.27 },
  { id:"petg-gold",        type:"PETG Basic", material:"PETG", color:"Gold",        hex:"#E4BD68", price:29.99, density:1.27 },
  { id:"petg-purple",      type:"PETG Basic", material:"PETG", color:"Purple",      hex:"#5E43B7", price:29.99, density:1.27 },
  { id:"petg-lime-green",  type:"PETG Basic", material:"PETG", color:"Lime Green",  hex:"#BECF00", price:29.99, density:1.27 },
  { id:"petg-natural",     type:"PETG Basic", material:"PETG", color:"Natural",     hex:"#F5F0E8", price:29.99, density:1.27 },
  { id:"petg-translucent", type:"PETG Basic", material:"PETG", color:"Translucent", hex:"#D6EAF8", price:29.99, density:1.27 },
  // ABS - 12 colours (official Bambu Lab hex codes)
  { id:"abs-white",            type:"ABS", material:"ABS", color:"White",           hex:"#FFFFFF", price:27.99, density:1.05 },
  { id:"abs-silver",           type:"ABS", material:"ABS", color:"Silver",          hex:"#87909A", price:27.99, density:1.05 },
  { id:"abs-black",            type:"ABS", material:"ABS", color:"Black",           hex:"#000000", price:27.99, density:1.05 },
  { id:"abs-red",              type:"ABS", material:"ABS", color:"Red",             hex:"#D32941", price:27.99, density:1.05 },
  { id:"abs-purple",           type:"ABS", material:"ABS", color:"Purple",          hex:"#AF1685", price:27.99, density:1.05 },
  { id:"abs-orange",           type:"ABS", material:"ABS", color:"Orange",          hex:"#FF6A13", price:27.99, density:1.05 },
  { id:"abs-tangerine-yellow", type:"ABS", material:"ABS", color:"Tangerine Yellow",hex:"#FFC72C", price:27.99, density:1.05 },
  { id:"abs-bambu-green",      type:"ABS", material:"ABS", color:"Bambu Green",     hex:"#00AE42", price:27.99, density:1.05 },
  { id:"abs-olive",            type:"ABS", material:"ABS", color:"Olive",           hex:"#789D4A", price:27.99, density:1.05 },
  { id:"abs-azure",            type:"ABS", material:"ABS", color:"Azure",           hex:"#489FDF", price:27.99, density:1.05 },
  { id:"abs-navy-blue",        type:"ABS", material:"ABS", color:"Navy Blue",       hex:"#0C2340", price:27.99, density:1.05 },
  { id:"abs-blue",             type:"ABS", material:"ABS", color:"Blue",            hex:"#0A2CA5", price:27.99, density:1.05 },
  // TPU 95A
  { id:"tpu-white",  type:"TPU 95A", material:"TPU", color:"White",  hex:"#FFFFFF", price:44.99, density:1.21 },
  { id:"tpu-black",  type:"TPU 95A", material:"TPU", color:"Black",  hex:"#000000", price:44.99, density:1.21 },
  { id:"tpu-red",    type:"TPU 95A", material:"TPU", color:"Red",    hex:"#C12E1F", price:44.99, density:1.21 },
  { id:"tpu-blue",   type:"TPU 95A", material:"TPU", color:"Blue",   hex:"#0A2989", price:44.99, density:1.21 },
  { id:"tpu-yellow", type:"TPU 95A", material:"TPU", color:"Yellow", hex:"#F4EE2A", price:44.99, density:1.21 },
  { id:"tpu-orange", type:"TPU 95A", material:"TPU", color:"Orange", hex:"#FF6A13", price:44.99, density:1.21 }
];

function buildDefaultInv() {
  // Default active filaments - the most common colours admins are likely to stock
  var active = [
    "plab-jade-white","plab-black","plab-gray","plab-red","plab-blue",
    "plab-bambu-green","plab-yellow","plab-orange",
    "petg-white","petg-black",
    "abs-white","abs-black",
    "tpu-black","tpu-white"
  ];
  return BAMBU.map(function(f) {
    var isActive = active.indexOf(f.id) >= 0;
    return Object.assign({}, f, { enabled: isActive, spoolsOwned: isActive ? 1 : 0, usedG: 0, custom: false });
  });
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
// Infill factor: Bambu default 15% gyroid + 3 walls + top/bottom ≈ 20% of solid volume
function estWeight(stats,material,qty) { if(!stats)return 0; return stats.volume*(DENSITIES[material]||1.24)*0.20*qty; }
function estCost(g,price) { return g*(price/SPOOL_G); }
function getRem(f) { return Math.max(0,(f.spoolsOwned||0)*SPOOL_G-(f.usedG||0)); }
function getStockStatus(f) { var r=getRem(f); if(!f.enabled)return"disabled"; if(r<=CRIT_G)return"critical"; if(r<=LOW_G)return"low"; return"ok"; }
var STATUS_STYLE = { ok:{color:"#22c55e",bg:"rgba(34,197,94,0.1)",label:"In Stock"}, low:{color:"#f59e0b",bg:"rgba(245,158,11,0.1)",label:"Low"}, critical:{color:"#ef4444",bg:"rgba(239,68,68,0.1)",label:"Critical"}, disabled:{color:"#64748b",bg:"rgba(75,85,99,0.1)",label:"Disabled"} };

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


// ─── Laser Consumables Defaults ───────────────────────────────────────────────
var LASER_CONSUMABLE_TYPES = [
  { id:"mat-light", name:"LightGrip Cutting Mat",  unit:"mat",   emoji:"🟩", desc:"310×320mm. For paper, vinyl, cardstock. Lasts ~20–50 cuts.",  price:22.00 },
  { id:"mat-strong",name:"StrongGrip Cutting Mat",  unit:"mat",   emoji:"🟦", desc:"310×320mm. For fabric, thick cardstock. Lasts ~10–30 cuts.", price:22.00 },
  { id:"wood-3",    name:"3mm Basswood Sheet",       unit:"sheet", emoji:"🪵", desc:"300×250mm. Standard laser plywood. Cuts cleanly at 40W.",     price:4.50  },
  { id:"wood-6",    name:"6mm Basswood Sheet",       unit:"sheet", emoji:"🪵", desc:"300×250mm. Thicker plywood. Requires slower speed at 40W.",   price:7.00  },
  { id:"vinyl-black",name:"Black Vinyl Roll",        unit:"sheet", emoji:"⬛", desc:"A4 sheet equivalent. For blade cutting — stickers & decals.", price:2.00  },
  { id:"vinyl-white",name:"White Vinyl Roll",        unit:"sheet", emoji:"⬜", desc:"A4 sheet equivalent. For blade cutting — stickers & decals.", price:2.00  },
  { id:"leather",   name:"Leather Sheet",            unit:"sheet", emoji:"🟤", desc:"A4 natural leather (1–2mm). Engrave or blade cut.",           price:8.00  },
  { id:"acrylic-3", name:"3mm Dark Acrylic Sheet",   unit:"sheet", emoji:"⬛", desc:"A4 dark/tinted acrylic. Cut and engrave with 40W laser.",     price:9.00  }
];
function buildDefaultLaserInv() {
  return LASER_CONSUMABLE_TYPES.map(function(c) {
    return Object.assign({}, c, { qty: 0, minQty: 2, custom: false });
  });
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


// ─── File Storage Helpers ─────────────────────────────────────────────────────
var MAX_STORE_BYTES = 1500000; // 1.5MB raw = ~2MB base64

function fileToBase64(file) {
  return new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { resolve(null); };
    reader.readAsDataURL(file);
  });
}

function downloadDataURL(dataUrl, filename) {
  var a = document.createElement("a");
  a.href = dataUrl; a.download = filename; a.click();
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(requests) {
  var headers = ["ID","Type","Project","Teacher","Email","Department","Status","Priority","Material","Colour","Quantity","Filename","Submitted","Due Date","Est Time (h)","Filament Used (g)","Cost (AUD)","Job Type","Laser Material"];
  var rows = requests.map(function(r) {
    var isLaser = r.jobCategory === "laser";
    var estH = (r.stlStats ? (r.stlStats.estimatedHours * r.quantity * 0.85).toFixed(2) : "");
    return [
      r.id, isLaser ? "Laser/Cut" : "3D Print",
      '"' + (r.projectName||"").replace(/"/g,'""') + '"',
      '"' + (r.teacherName||"").replace(/"/g,'""') + '"',
      r.email||"", r.department||"", r.status,
      r.priority ? "Urgent" : "Normal",
      r.material||"", r.color||"", r.quantity||1,
      '"' + (r.fileName||"").replace(/"/g,'""') + '"',
      r.submittedAt ? new Date(r.submittedAt).toLocaleDateString("en-AU") : "",
      r.dueDate||"", estH,
      r.filamentUsedG ? r.filamentUsedG.toFixed(0) : "",
      r.estimatedCostAUD ? r.estimatedCostAUD.toFixed(2) : "",
      r.jobType||"", r.laserMaterial||""
    ].join(",");
  });
  var csv = [headers.join(",")].concat(rows).join("\n");
  var blob = new Blob([csv], { type: "text/csv" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a"); a.href = url; a.download = "printlab-queue-" + new Date().toISOString().split("T")[0] + ".csv"; a.click();
  setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
}

// ─── SVG Dimension Parser ─────────────────────────────────────────────────────
function parseSVGDimensions(svgText) {
  // Try to extract width/height in mm from SVG attributes
  try {
    var wMatch = svgText.match(/width="([0-9.]+)(mm|cm|in|px)?"/i);
    var hMatch = svgText.match(/height="([0-9.]+)(mm|cm|in|px)?"/i);
    var vbMatch = svgText.match(/viewBox="([0-9.\s-]+)"/i);
    if (!wMatch && !hMatch && !vbMatch) return null;
    function toMM(val, unit) {
      val = parseFloat(val);
      if (unit === "cm") return val * 10;
      if (unit === "in") return val * 25.4;
      if (!unit || unit === "px") return val / 3.7795; // 96dpi
      return val; // mm
    }
    var wMM = wMatch ? toMM(wMatch[1], wMatch[2]) : null;
    var hMM = hMatch ? toMM(hMatch[1], hMatch[2]) : null;
    if (!wMM && vbMatch) {
      var parts = vbMatch[1].trim().split(/\s+/);
      if (parts.length >= 4) { wMM = parseFloat(parts[2]) / 3.7795; hMM = parseFloat(parts[3]) / 3.7795; }
    }
    return { wMM: Math.round(wMM || 0), hMM: Math.round(hMM || 0) };
  } catch(e) { return null; }
}

function checkLaserWorkArea(dims) {
  // H2D 40W: 310 x 250mm
  var warnings = [];
  if (dims.wMM > 310) warnings.push("Design width (" + dims.wMM + "mm) exceeds H2D 40W work area width (310mm).");
  if (dims.hMM > 250) warnings.push("Design height (" + dims.hMM + "mm) exceeds H2D 40W work area height (250mm).");
  return warnings;
}

// ─── .3mf Detection + Basic Parsing ──────────────────────────────────────────
function is3MF(buffer) {
  // ZIP magic bytes: PK (0x50 0x4B 0x03 0x04)
  if (buffer.byteLength < 4) return false;
  var view = new DataView(buffer);
  return view.getUint8(0) === 0x50 && view.getUint8(1) === 0x4B;
}

function extract3MFMeta(buffer) {
  // Scan ZIP file for [Content_Types].xml or model.model to confirm it is a valid .3mf
  // Then try to extract print settings from embedded metadata
  var result = { valid: false, layerHeight: null, infill: null, material: null };
  try {
    var text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buffer));
    if (text.indexOf("3D/3dmodel.model") >= 0 || text.indexOf("application/vnd.ms-package.3dmanufacturing") >= 0) {
      result.valid = true;
      var lhMatch = text.match(/layer_height[">= ]+([0-9.]+)/i);
      var infMatch = text.match(/fill_density[">= ]+([0-9]+)/i);
      var matMatch = text.match(/filament_type[">= ]+([A-Z0-9+]+)/i);
      if (lhMatch) result.layerHeight = parseFloat(lhMatch[1]);
      if (infMatch) result.infill = parseInt(infMatch[1]);
      if (matMatch) result.material = matMatch[1].toUpperCase();
    }
  } catch(e) {}
  return result;
}

// ─── Filament Sufficiency Check ───────────────────────────────────────────────
function checkFilamentSufficiency(inv, req) {
  if (!req.stlStats || !req.material) return null;
  var needed = estWeight(req.stlStats, req.material, req.quantity);
  var match = null;
  for (var i = 0; i < inv.length; i++) {
    if (inv[i].enabled && inv[i].material === req.material && (req.color === "Any" || inv[i].color === req.color)) {
      match = inv[i]; break;
    }
  }
  if (!match) return { ok: false, msg: "No matching " + req.material + " (" + req.color + ") in inventory.", needed: needed, available: 0 };
  var avail = getRem(match);
  if (avail < needed) return { ok: false, msg: "Need " + needed.toFixed(0) + "g but only " + avail.toFixed(0) + "g of " + match.type + " " + match.color + " remaining.", needed: needed, available: avail };
  if (avail < needed * 1.15) return { ok: "warn", msg: "Cutting it close — " + avail.toFixed(0) + "g available, " + needed.toFixed(0) + "g needed. Consider checking spool before starting.", needed: needed, available: avail };
  return { ok: true, msg: needed.toFixed(0) + "g needed — " + avail.toFixed(0) + "g of " + match.color + " " + match.type + " available.", needed: needed, available: avail };
}

// --- Reject / Fail email helpers ---
function sendRejectEmail(req, admin, reason) {
  var adminName = admin && admin.name ? admin.name : "Print Lab";
  var parts = ["Hi " + req.teacherName + ",", "", "Your request could not be processed.", "", "Project: " + req.projectName];
  if (reason) parts.push("", "Reason: " + reason);
  parts.push("", "Please resubmit or contact the Print Lab.", "", "Thanks,", adminName);
  var body = parts.join("\n");
  window.open("mailto:" + req.email + "?subject=" + encodeURIComponent("Print Request Update - " + req.projectName) + "&body=" + encodeURIComponent(body));
}
function sendFailedEmail(req, admin, reason) {
  var adminName = admin && admin.name ? admin.name : "Print Lab";
  var parts = ["Hi " + req.teacherName + ",", "", "Your print encountered an issue and did not complete.", "", "Project: " + req.projectName];
  if (reason) parts.push("", "Details: " + reason);
  parts.push("", "We will re-queue as soon as possible.", "", "Sorry for the delay,", adminName);
  var body = parts.join("\n");
  window.open("mailto:" + req.email + "?subject=" + encodeURIComponent("Print Failed - " + req.projectName) + "&body=" + encodeURIComponent(body));
}
// ─── Responsive hook ──────────────────────────────────────────────────────────
function useWidth() {
  var s=useState(typeof window!=="undefined"?window.innerWidth:1024); var w=s[0],setW=s[1];
  useEffect(function(){ function h(){setW(window.innerWidth);} window.addEventListener("resize",h); return function(){window.removeEventListener("resize",h);}; },[]);
  return w;
}

// ─── Shared styles ────────────────────────────────────────────────────────────
var baseInput = { width:"100%", background:"#0f172a", border:"1px solid #111827", borderRadius:8, padding:"10px 13px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none", transition:"border-color 0.15s" };
var smallInput = { width:"100%", background:"#0f172a", border:"1px solid #1a2035", borderRadius:7, padding:"8px 11px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none" };
var selectStyle = { width:"100%", background:"#0f172a", border:"1px solid #111827", borderRadius:8, padding:"10px 13px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none", cursor:"pointer", colorScheme:"dark" };

// ─── UI Components ────────────────────────────────────────────────────────────
function Lbl({ children, color }) { return <div style={{ fontSize:11, color:color||"#94a3b8", fontWeight:500, marginBottom:6, fontFamily:"'Inter',sans-serif" }}>{children}</div>; }
function Card({ title, children, accent, action }) {
  var accentColor = accent === "laser" ? "#7c3aed" : accent ? "#ea580c" : null;
  var borderColor = accentColor ? accentColor+"44" : "#334155";
  return <div style={{ background:"#1e293b", border:"1px solid "+borderColor, borderRadius:10, overflow:"hidden" }}>
    <div style={{ padding:"10px 16px", borderBottom:"1px solid #334155", fontSize:11, color:accentColor||"#64748b", fontWeight:500, display:"flex", justifyContent:"space-between", alignItems:"center", fontFamily:"'Inter',sans-serif", letterSpacing:"0.02em" }}>
      <span>{title}</span>{action}
    </div>
    <div style={{ padding:16, display:"flex", flexDirection:"column", gap:14 }}>{children}</div>
  </div>;
}
function StatCard({ emoji, value, label, color }) { return <div style={{ background:"#1e293b", border:"1px solid #111827", borderRadius:12, padding:16, textAlign:"center" }}><div style={{ fontSize:28, marginBottom:8 }}>{emoji}</div><div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:22, color:color||"#e2e8f0", marginBottom:2 }}>{value}</div><div style={{ fontSize:11, color:"#94a3b8" }}>{label}</div></div>; }
function InfoTile({ e, l, v, s, c }) { return <div style={{ background:"#1e293b", border:"1px solid #111827", borderRadius:10, padding:12, textAlign:"center" }}><div style={{ fontSize:22, marginBottom:4 }}>{e}</div><div style={{ fontSize:9, color:"#64748b", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:2 }}>{l}</div><div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, color:c||"#e2e8f0" }}>{v}</div><div style={{ fontSize:9, color:"#64748b", marginTop:3, lineHeight:1.5 }}>{s}</div></div>; }
function Btn({ onClick, color, bg, border, children, disabled, style }) {
  var bgC=disabled?"#0a0f1a":(bg||"#ea580c");
  var txC=disabled?"#475569":(color||"#fff");
  var bd=disabled?"1px solid #111827":(border||"none");
  return <button onClick={disabled?undefined:onClick} disabled={!!disabled} className={disabled?"":"bh"} style={Object.assign({ background:bgC, color:txC, border:bd, borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:disabled?"not-allowed":"pointer", letterSpacing:"0.08em", textTransform:"uppercase", width:"100%", boxShadow:disabled?"none":"0 0 18px rgba(249,115,22,0.2)" },style||{})}>{children}</button>;
}
function NavBtns({ onBack, onNext, disabled, label }) {
  return <div style={{ display:"flex", gap:10, marginTop:4 }}>
    {onBack&&<button onClick={onBack} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:8, padding:"12px 22px", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>← Back</button>}
    <button onClick={disabled?undefined:onNext} disabled={!!disabled} className={disabled?"":"bh"} style={{ flex:1, background:disabled?"#0a0f1a":"#ea580c", color:disabled?"#475569":"#fff", border:"none", borderRadius:8, padding:"13px 0", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:disabled?"not-allowed":"pointer", letterSpacing:"0.1em", textTransform:"uppercase" }}>
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
          <div style={{ width:30, height:30, borderRadius:"50%", border:"2px solid "+(active||done?"#f97316":"#334155"), background:done?"#f97316":active?"rgba(249,115,22,0.12)":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:(active||done)?"#f97316":"#475569", fontWeight:600 }}>{done?"✓":i+1}</div>
          <div style={{ fontSize:8, color:active?"#f97316":done?"#94a3b8":"#475569", letterSpacing:"0.1em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{s}</div>
        </div>
        {i<steps.length-1&&<div style={{ flex:1, height:2, background:done?"#f97316":"#334155", margin:"0 6px", marginBottom:18 }}/>}
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
  return <div style={{ position:"relative", width:"100%", height:240, borderRadius:12, overflow:"hidden", background:"#162032" }}>
    <div ref={ref} style={{ width:"100%", height:"100%" }}/>
    <div style={{ position:"absolute", bottom:8, left:12, fontSize:9, color:"#2d3748", pointerEvents:"none" }}>DRAG TO ROTATE</div>
    <div style={{ position:"absolute", top:8, right:10, display:"flex", alignItems:"center", gap:5, pointerEvents:"none" }}>
      <div style={{ width:5, height:5, borderRadius:"50%", background:"#f97316" }}/>
      <span style={{ fontSize:9, color:"#f97316" }}>3D PREVIEW</span>
    </div>
  </div>;
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function Countdown({ startedAt, totalHours }) {
  var totalMs = totalHours * 3600000;
  var sr = useState(0); var rem = sr[0], setRem = sr[1];
  useEffect(function() {
    function tick() { setRem(Math.max(0, new Date(startedAt).getTime() + totalMs - Date.now())); }
    tick();
    var id = setInterval(tick, 1000);
    return function() { clearInterval(id); };
  }, [startedAt, totalMs]);
  var done = rem === 0;
  var elapsed = Date.now() - new Date(startedAt).getTime();
  var prog = done ? 1 : Math.min(1, elapsed / totalMs);
  var pct = Math.round(prog * 100);
  var h = Math.floor(rem / 3600000);
  var m = Math.floor((rem % 3600000) / 60000);
  var s = Math.floor((rem % 60000) / 1000);
  var hS = h < 10 ? "0" + h : "" + h;
  var mS = m < 10 ? "0" + m : "" + m;
  var sS = s < 10 ? "0" + s : "" + s;
  var etaMs = new Date(startedAt).getTime() + totalMs;
  var etaDate = new Date(etaMs);
  var isToday = new Date().toDateString() === etaDate.toDateString();
  var etaStr = isToday
    ? "Today at " + etaDate.toLocaleTimeString("en-AU", { hour:"2-digit", minute:"2-digit" })
    : etaDate.toLocaleDateString("en-AU", { weekday:"short", day:"numeric", month:"short" }) + " at " + etaDate.toLocaleTimeString("en-AU", { hour:"2-digit", minute:"2-digit" });
  var barColor = done ? "#22c55e" : pct > 80 ? "#22c55e" : pct > 40 ? "#3b82f6" : "#f97316";
  var C = 2 * Math.PI * 52;
  return <div style={{ background:"rgba(59,130,246,0.05)", border:"1px solid rgba(59,130,246,0.2)", borderRadius:12, padding:20 }}>
    <div style={{ display:"flex", gap:20, alignItems:"center" }}>
      <div style={{ position:"relative", width:120, height:120, flexShrink:0 }}>
        <svg width="120" height="120" style={{ transform:"rotate(-90deg)" }}>
          <circle cx="60" cy="60" r="52" fill="none" stroke="#1e293b" strokeWidth="8"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke={barColor} strokeWidth="8"
            strokeDasharray={C} strokeDashoffset={C * (1 - prog)} strokeLinecap="round"
            style={{ transition:"stroke-dashoffset 1s linear, stroke .5s" }}/>
        </svg>
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
          {done
            ? <span style={{ fontSize:28 }}>✅</span>
            : <div style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:15, fontWeight:500, color:barColor, lineHeight:1 }}>{hS}:{mS}:{sS}</div>
                <div style={{ fontSize:9, color:"#64748b", marginTop:3, letterSpacing:"0.05em" }}>REMAINING</div>
              </div>}
        </div>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:16, fontWeight:600, color:done?"#22c55e":"#f1f5f9", marginBottom:6 }}>
          {done ? "Print complete!" : "Printing now"}
        </div>
        {!done&&<div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <div style={{ fontSize:12, color:"#64748b" }}>{pct}% complete</div>
            <div style={{ fontSize:12, color:"#64748b" }}>{100-pct}% remaining</div>
          </div>
          <div style={{ height:6, background:"#1e293b", borderRadius:3, overflow:"hidden", marginBottom:10 }}>
            <div style={{ height:"100%", width:pct+"%", background:barColor, borderRadius:3, transition:"width 1s linear" }}/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div style={{ background:"#162032", borderRadius:8, padding:"8px 12px" }}>
              <div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>TIME REMAINING</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:16, color:"#3b82f6", fontWeight:500 }}>{hS}:{mS}:{sS}</div>
            </div>
            <div style={{ background:"#162032", borderRadius:8, padding:"8px 12px" }}>
              <div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>ESTIMATED FINISH</div>
              <div style={{ fontSize:11, color:"#94a3b8", fontWeight:500, lineHeight:1.4 }}>{etaStr}</div>
            </div>
          </div>
        </div>}
        {done&&<div style={{ fontSize:12, color:"#64748b", lineHeight:1.7 }}>
          Your print has finished. Head to the lab to pick it up.
        </div>}
      </div>
    </div>
  </div>;
}

// ─── Teacher Status ────────────────────────────────────────────────────────────
function TeacherStatus({ requests }) {
  var se = useState(""); var email = se[0], setEmail = se[1];
  var ss = useState(null); var searched = ss[0], setSearched = ss[1];
  function search() {
    var lc = email.toLowerCase().trim();
    setSearched(requests.filter(function(r) { return r.email && r.email.toLowerCase() === lc; }));
    // Seed initial status snapshot for notifications
    checkStatusChanges(requests, lc);
  }
  function queuePosition(req) {
    var ahead = requests.filter(function(r) {
      return (r.status === "Queued" || r.status === "Printing") && r.id !== req.id && new Date(r.submittedAt) <= new Date(req.submittedAt);
    });
    return ahead.length + 1;
  }
  function getTotalHours(req) {
    if (req.stlStats) return req.stlStats.estimatedHours * (req.quantity || 1) * 0.85;
    if (req.jobCategory === "laser") {
      var w = req.designWidth || (req.svgDimsMM ? req.svgDimsMM.wMM : 100);
      var ht = req.designHeight || (req.svgDimsMM ? req.svgDimsMM.hMM : 100);
      var area = parseFloat(w) * parseFloat(ht);
      var factor = req.jobType === "Engrave" ? 1.0 : req.jobType === "Cut" ? 0.4 : req.jobType === "Engrave & Cut" ? 1.5 : 0.3;
      var minutes = Math.max(5, Math.round((area / (800 * 60)) * 60 * factor * (req.quantity || 1)));
      return minutes / 60;
    }
    return 2;
  }
  var STATUS_INFO = {
    Pending:  { color:"#94a3b8", bg:"rgba(148,163,184,0.08)", border:"rgba(148,163,184,0.2)", label:"Awaiting Review",  icon:"⏸", msg:"Your request has been submitted and is waiting for admin review. You will receive an email once it is approved." },
    Queued:   { color:"#f59e0b", bg:"rgba(245,158,11,0.08)",  border:"rgba(245,158,11,0.2)",  label:"In Queue",         icon:"📋", msg:"Your request has been approved and is in the queue." },
    Printing: { color:"#3b82f6", bg:"rgba(59,130,246,0.08)",  border:"rgba(59,130,246,0.2)",  label:"Printing Now",     icon:"🖨️", msg:"Your job is currently printing. See the live countdown below." },
    Done:     { color:"#22c55e", bg:"rgba(34,197,94,0.08)",   border:"rgba(34,197,94,0.2)",   label:"Ready for Pickup", icon:"✅", msg:"Your print is finished! Collect it from the Print Lab." },
    Failed:   { color:"#ef4444", bg:"rgba(239,68,68,0.08)",   border:"rgba(239,68,68,0.2)",   label:"Job Failed",       icon:"⚠️", msg:"This job encountered an issue. The admin will be in touch to re-queue it." },
    Cancelled:{ color:"#64748b", bg:"rgba(100,116,139,0.08)", border:"rgba(100,116,139,0.2)", label:"Cancelled",        icon:"✕",  msg:"This request was cancelled. Submit a new request if you still need this." }
  };
  return <div>
    <div style={{ textAlign:"center", marginBottom:28 }}>
      <div style={{ fontSize:22, fontWeight:600, marginBottom:6 }}>Check Your Job Status</div>
      <div style={{ fontSize:13, color:"#64748b" }}>Enter your school email to see all your print and laser requests</div>
    </div>
    <div style={{ maxWidth:540, margin:"0 auto" }}>
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <input value={email} onChange={function(e){setEmail(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")search();}} placeholder="your.email@macc.nsw.edu.au" style={Object.assign({},baseInput,{flex:1})}/>
        <button onClick={search} disabled={!email} className="bh" style={{ background:"#2563eb", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", fontFamily:"inherit", fontSize:13, cursor:email?"pointer":"not-allowed", fontWeight:500, whiteSpace:"nowrap" }}>Check Status</button>
      </div>
      {("Notification" in window)&&<div style={{ background:"rgba(59,130,246,0.05)", border:"1px solid rgba(59,130,246,0.15)", borderRadius:10, padding:"12px 16px", marginBottom:24, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:500, color:"#f1f5f9", marginBottom:2 }}>Job notifications</div>
          <div style={{ fontSize:11, color:"#64748b" }}>
            {(typeof Notification!=="undefined"&&Notification.permission==="granted")?"You will receive a browser notification when your job status changes. Keep this tab open.":"Get notified when your print starts, completes, or has an issue — no need to keep checking manually."}
          </div>
        </div>
        {(typeof Notification!=="undefined"&&Notification.permission==="granted")
          ?<div style={{ fontSize:12, color:"#4ade80", flexShrink:0, display:"flex", alignItems:"center", gap:6 }}><div style={{ width:8, height:8, borderRadius:"50%", background:"#22c55e" }}/> Notifications on</div>
          :<button className="bh" onClick={function(){requestNotifPermission().then(function(p){if(p==="granted"&&email){checkStatusChanges(requests,email);;}});}} style={{ background:"#2563eb", color:"#fff", border:"none", borderRadius:7, padding:"8px 14px", fontFamily:"inherit", fontSize:12, cursor:"pointer", fontWeight:500, flexShrink:0, whiteSpace:"nowrap" }}>Enable Notifications</button>}
      </div>}
      {searched !== null && <div>
        {searched.length === 0
          ? <div style={{ textAlign:"center", padding:"40px 0", color:"#64748b" }}>
              <div style={{ fontSize:36, marginBottom:10, opacity:0.3 }}>🔍</div>
              <div style={{ fontSize:14 }}>No requests found for that email.</div>
              <div style={{ fontSize:12, color:"#475569", marginTop:6 }}>Check the address and try again, or submit a new request.</div>
            </div>
          : <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ fontSize:12, color:"#64748b" }}>{searched.length} request{searched.length!==1?"s":""} found for <span style={{ color:"#94a3b8" }}>{email}</span></div>
              {searched.sort(function(a,b){return new Date(b.submittedAt)-new Date(a.submittedAt);}).map(function(req) {
                var si = STATUS_INFO[req.status] || STATUS_INFO.Pending;
                var isLaser = req.jobCategory === "laser";
                var isQueued = req.status === "Queued";
                var isPrinting = req.status === "Printing" && req.printStartedAt;
                var pos = isQueued ? queuePosition(req) : null;
                var totalHrs = getTotalHours(req);
                return <div key={req.id} style={{ background:"#1e293b", border:"1px solid "+si.border, borderRadius:12, overflow:"hidden" }}>
                  <div style={{ padding:"14px 16px", borderBottom:"1px solid #334155", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                        {isLaser&&<span style={{ fontSize:9, background:"rgba(124,58,237,0.15)", color:"#a78bfa", borderRadius:3, padding:"2px 6px", fontWeight:600 }}>LASER</span>}
                        {req.priority&&<span style={{ fontSize:9, background:"rgba(239,68,68,0.15)", color:"#fca5a5", borderRadius:3, padding:"2px 6px", fontWeight:600 }}>URGENT</span>}
                        <div style={{ fontSize:15, fontWeight:600, color:"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{req.projectName}</div>
                      </div>
                      <div style={{ fontSize:11, color:"#64748b" }}>
                        Submitted {new Date(req.submittedAt).toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}
                        {req.dueDate&&" · Due "+new Date(req.dueDate+"T00:00:00").toLocaleDateString("en-AU",{day:"numeric",month:"short"})}
                      </div>
                    </div>
                    <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6, background:si.bg, border:"1px solid "+si.border, borderRadius:6, padding:"5px 10px" }}>
                      <span>{si.icon}</span>
                      <span style={{ fontSize:11, color:si.color, fontWeight:600 }}>{si.label}</span>
                    </div>
                  </div>
                  <div style={{ padding:"14px 16px" }}>
                    <div style={{ fontSize:12, color:"#64748b", lineHeight:1.7, marginBottom:12 }}>{si.msg}</div>
                    {isQueued&&pos!==null&&<div style={{ background:"rgba(245,158,11,0.07)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:10, padding:"12px 16px", marginBottom:12, display:"flex", alignItems:"center", gap:14 }}>
                      <div style={{ textAlign:"center", flexShrink:0 }}>
                        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:28, fontWeight:700, color:"#f59e0b", lineHeight:1 }}>#{pos}</div>
                        <div style={{ fontSize:9, color:"#64748b", marginTop:2, letterSpacing:"0.06em" }}>IN QUEUE</div>
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, color:"#f1f5f9", fontWeight:500, marginBottom:3 }}>{pos===1?"You are next to print!":pos+" jobs ahead of yours"}</div>
                        {req.estimatedReadyDate&&<div style={{ fontSize:11, color:"#64748b" }}>Estimated ready: {new Date(req.estimatedReadyDate).toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short"})}</div>}
                        {totalHrs>0&&<div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>Estimated print time: {fmtH(totalHrs)}</div>}
                      </div>
                    </div>}
                    {isPrinting&&<div style={{ marginBottom:12 }}><Countdown startedAt={req.printStartedAt} totalHours={totalHrs}/></div>}
                    {req.status==="Cancelled"&&req.rejectionReason&&<div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"10px 12px", marginBottom:12, fontSize:12, color:"#94a3b8" }}><span style={{ color:"#fca5a5", fontWeight:500 }}>Reason: </span>{req.rejectionReason}</div>}
                    {req.status==="Failed"&&req.failureReason&&<div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"10px 12px", marginBottom:12, fontSize:12, color:"#94a3b8" }}><span style={{ color:"#fca5a5", fontWeight:500 }}>Issue: </span>{req.failureReason}</div>}
                    {req.status==="Done"&&<div style={{ background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.25)", borderRadius:10, padding:"12px 16px", marginBottom:12, display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ fontSize:28, flexShrink:0 }}>✅</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:"#4ade80", marginBottom:2 }}>Ready for collection!</div>
                        <div style={{ fontSize:11, color:"#64748b" }}>Your {isLaser?"laser job":"print"} is complete. Head to the Print Lab to pick it up.</div>
                      </div>
                    </div>}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      {!isLaser&&req.material&&<div style={{ background:"#162032", borderRadius:7, padding:"8px 11px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>MATERIAL</div><div style={{ fontSize:11, color:"#94a3b8" }}>{req.material}{req.color?" — "+req.color:""}</div></div>}
                      {isLaser&&req.jobType&&<div style={{ background:"#162032", borderRadius:7, padding:"8px 11px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>JOB TYPE</div><div style={{ fontSize:11, color:"#94a3b8" }}>{req.jobType}{req.laserMaterial?" — "+req.laserMaterial:""}</div></div>}
                      <div style={{ background:"#162032", borderRadius:7, padding:"8px 11px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>QUANTITY</div><div style={{ fontSize:11, color:"#94a3b8" }}>x{req.quantity||1}</div></div>
                      {req.fileName&&<div style={{ background:"#162032", borderRadius:7, padding:"8px 11px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>FILE</div><div style={{ fontSize:11, color:"#94a3b8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{req.fileName}</div></div>}
                      {req.department&&<div style={{ background:"#162032", borderRadius:7, padding:"8px 11px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:2 }}>DEPARTMENT</div><div style={{ fontSize:11, color:"#94a3b8" }}>{req.department}</div></div>}
                    </div>
                  </div>
                </div>;
              })}
            </div>}
      </div>}
    </div>
  </div>;
}
function PublicStats({ requests }) {
  var done = requests.filter(function(r) { return r.status === "Done"; });
  var printing = requests.filter(function(r) { return r.status === "Printing"; });
  var queued = requests.filter(function(r) { return r.status === "Queued"; });
  var printDone = done.filter(function(r) { return r.jobCategory !== "laser"; });
  var all3D = requests.filter(function(r) { return r.jobCategory !== "laser"; });
  var allLaser = requests.filter(function(r) { return r.jobCategory === "laser"; });

  var totalFilG = printDone.reduce(function(a,r) { return a + (r.filamentUsedG || estWeight(r.stlStats, r.material, r.quantity)); }, 0);
  var totalHrs = printDone.reduce(function(a,r) { return a + (r.stlStats ? r.stlStats.estimatedHours * r.quantity * 0.85 : 0); }, 0);
  var totalCost = done.reduce(function(a,r) { return a + (r.estimatedCostAUD || 0); }, 0);
  var totalPieces = printDone.reduce(function(a,r) { return a + r.quantity; }, 0);

  var totalMeters = totalFilG / (Math.PI * Math.pow(0.0875, 2) * 100 * 1.24);
  var totalSpools = totalFilG / 1000;

  var deptC = {}; done.forEach(function(r) { var d = r.department || "General"; deptC[d] = (deptC[d] || 0) + r.quantity; });
  var deptEntries = Object.entries(deptC).sort(function(a,b) { return b[1]-a[1]; });
  var topDept = deptEntries.length > 0 ? deptEntries[0] : null;
  var matC = {}; printDone.forEach(function(r) { matC[r.material] = (matC[r.material] || 0) + r.quantity; });
  var topMat = Object.entries(matC).sort(function(a,b) { return b[1]-a[1]; })[0];
  var colC = {}; printDone.forEach(function(r) { colC[r.color] = (colC[r.color] || 0) + r.quantity; });
  var topCol = Object.entries(colC).sort(function(a,b) { return b[1]-a[1]; })[0];
  var teachers = {}; requests.forEach(function(r) { if (r.teacherName) teachers[r.teacherName] = true; });
  var uniqueTeachers = Object.keys(teachers).length;
  var uniqueColors = Object.keys(colC).length;

  var longestHrs = 0; var longestJob = null;
  printDone.forEach(function(r) { var h = r.stlStats ? r.stlStats.estimatedHours * r.quantity * 0.85 : 0; if (h > longestHrs) { longestHrs = h; longestJob = r; } });
  var mostCopies = 0; var mostCopiesJob = null;
  printDone.forEach(function(r) { if (r.quantity > mostCopies) { mostCopies = r.quantity; mostCopiesJob = r; } });
  var dayC = [0,0,0,0,0,0,0];
  var dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  requests.forEach(function(r) { var d = new Date(r.submittedAt).getDay(); dayC[d]++; });
  var busiestDay = dayC.indexOf(Math.max.apply(null, dayC));
  var firstJob = null;
  requests.forEach(function(r) { if (!firstJob || new Date(r.submittedAt) < new Date(firstJob.submittedAt)) firstJob = r; });
  var daysSinceFirst = firstJob ? Math.floor((Date.now() - new Date(firstJob.submittedAt)) / 86400000) : 0;
  var avgHrs = printDone.length > 0 ? totalHrs / printDone.length : 0;
  var eggEquiv = Math.round(totalFilG / 60);
  var waterBottles = (totalFilG / 1000).toFixed(1);
  var sydneyHarbourBridgeM = 1149;
  var sydneyOperaHouseM = 67;
  var cricketPitchM = 20.12;

  function meterComparison(m) {
    if (m <= 0) return "";
    if (m < cricketPitchM) return "shorter than a cricket pitch!";
    if (m < 100) return "about " + Math.round(m / cricketPitchM * 10) / 10 + " cricket pitches end-to-end";
    if (m < sydneyOperaHouseM) return "reaching " + Math.round(m) + "m into the air";
    if (m < sydneyHarbourBridgeM * 0.5) return "taller than the Sydney Opera House shells (" + sydneyOperaHouseM + "m)!";
    if (m < sydneyHarbourBridgeM) return "over half the length of the Sydney Harbour Bridge!";
    if (m < 87800) return (m / 1000).toFixed(2) + "km — " + (m / sydneyHarbourBridgeM).toFixed(1) + "x the Harbour Bridge!";
    return "further than Sydney to Melbourne (878km)!";
  }

  function hourComparison(h) {
    if (h < 1) return "less than an hour of printing";
    if (h < 8) return "a full school period of printing!";
    if (h < 24) return "almost " + Math.round(h) + " hours straight";
    if (h < 168) return Math.round(h / 24) + " full days of non-stop printing";
    if (h < 720) return Math.round(h / 24) + " days — " + Math.round(h / 168) + " weeks straight!";
    return Math.round(h / 720) + " months of non-stop printing!";
  }

  var funFacts = [];

  if (totalMeters > 0) {
    funFacts.push({ emoji:"📏", fact: fmtMeters(totalMeters) + " of filament", sub: "If laid end-to-end: " + meterComparison(totalMeters), color:"#f97316" });
    funFacts.push({ emoji:"🧶", fact: totalSpools.toFixed(2) + " full Bambu spools", sub: "Each spool holds exactly 1kg. You have used " + (totalFilG / 1000).toFixed(2) + "kg of filament in total.", color:"#22c55e" });
    funFacts.push({ emoji:"🥚", fact: eggEquiv + " chicken eggs", sub: "The total filament weight equals about " + eggEquiv + " eggs (1 egg ≈ 60g). That is " + totalFilG.toFixed(0) + "g of plastic!", color:"#f59e0b" });
    funFacts.push({ emoji:"💧", fact: waterBottles + "L of water", sub: "Your filament weighs as much as " + waterBottles + " full 1-litre water bottles.", color:"#3b82f6" });
  }

  if (totalHrs > 0) {
    funFacts.push({ emoji:"⏱️", fact: fmtH(totalHrs) + " printing", sub: "The X1C has been running for " + hourComparison(totalHrs) + " this term.", color:"#a855f7" });
    if (avgHrs > 0) { funFacts.push({ emoji:"📐", fact: fmtH(avgHrs) + " average per job", sub: "Average time from start to finish for a 3D print job at MACC.", color:"#64748b" }); }
  }

  if (longestJob) {
    funFacts.push({ emoji:"🏆", fact: fmtH(longestHrs) + " marathon", sub: "Longest single job: " + longestJob.projectName + " by " + longestJob.teacherName + ". A true test of patience!", color:"#f97316" });
  }

  if (mostCopiesJob && mostCopies > 1) {
    funFacts.push({ emoji:"📦", fact: "x" + mostCopies + " in one batch!", sub: "Most copies at once: " + mostCopiesJob.projectName + " — " + mostCopies + " identical pieces in one print run.", color:"#22c55e" });
  }

  if (topDept) {
    funFacts.push({ emoji:"🏅", fact: topDept[0] + " leads the term", sub: "Most active department — " + topDept[1] + " piece" + (topDept[1]>1?"s":"") + " produced. " + (deptEntries.length > 1 ? deptEntries[1][0] + " in second place." : ""), color:"#f59e0b" });
  }

  if (topCol) {
    funFacts.push({ emoji:"🎨", fact: topCol[0] + " most popular colour", sub: "Chosen " + topCol[1] + " time" + (topCol[1]>1?"s":"") + " — the students clearly have good taste!", color:"#ec4899" });
  }

  if (topMat) {
    funFacts.push({ emoji:"🧱", fact: topMat[0] + " is top material", sub: "Used for " + topMat[1] + " out of " + totalPieces + " pieces. " + (topMat[0]==="PLA"?"Safe, affordable, and easy to print — the classroom favourite.":topMat[0]==="PETG"?"Tougher than PLA — great choice for durable parts!":"A bold choice!"), color:"#06b6d4" });
  }

  if (uniqueColors > 0) {
    funFacts.push({ emoji:"🌈", fact: uniqueColors + " unique colour" + (uniqueColors>1?"s":"") + " used", sub: "Out of 84 Bambu Lab colours in the catalog — " + Math.round(uniqueColors/84*100) + "% explored so far! " + (uniqueColors >= 10 ? "The rainbow is filling up!" : "Plenty more to discover."), color:"#a855f7" });
  }

  if (uniqueTeachers > 0) {
    funFacts.push({ emoji:"👩‍🏫", fact: uniqueTeachers + " teacher" + (uniqueTeachers>1?"s":"") + " creating", sub: "Unique staff members who have submitted to the Print Lab" + (uniqueTeachers > 8 ? " — almost the whole school!" : uniqueTeachers > 4 ? " — a growing team!" : " — tell your colleagues!"), color:"#22c55e" });
  }

  if (daysSinceFirst > 0) {
    var avgPerDay = (done.length / Math.max(1, daysSinceFirst)).toFixed(1);
    funFacts.push({ emoji:"📅", fact: daysSinceFirst + " days active", sub: "Print Lab has been running for " + daysSinceFirst + " days — averaging " + avgPerDay + " completed job" + (parseFloat(avgPerDay)!==1?"s":"") + " per day.", color:"#3b82f6" });
  }

  if (requests.length >= 3 && dayC[busiestDay] > 0) {
    funFacts.push({ emoji:"📆", fact: dayNames[busiestDay] + " is busiest", sub: "Most requests arrive on " + dayNames[busiestDay] + "s (" + dayC[busiestDay] + " requests). Lesson planning on " + (busiestDay===1?"the weekend":"the previous day") + "?", color:"#f97316" });
  }

  if (allLaser.length > 0) {
    var laserTypeC = {};
    allLaser.forEach(function(r) { var jt = r.jobType || "Engrave"; laserTypeC[jt] = (laserTypeC[jt] || 0) + 1; });
    var topLaserType = Object.entries(laserTypeC).sort(function(a,b) { return b[1]-a[1]; })[0];
    var laserDoneCount = allLaser.filter(function(r) { return r.status === "Done"; }).length;
    funFacts.push({ emoji:"🔴", fact: allLaser.length + " laser job" + (allLaser.length>1?"s":""), sub: (topLaserType ? "Most common: " + topLaserType[0] + " (" + topLaserType[1] + ")" : "") + (laserDoneCount > 0 ? " — " + laserDoneCount + " completed." : " — the H2D is getting a workout!"), color:"#a855f7" });
  }

  if (deptEntries.length > 1) {
    funFacts.push({ emoji:"🤝", fact: deptEntries.length + " departments involved", sub: "Collaborating across: " + deptEntries.slice(0,4).map(function(e) { return e[0]; }).join(", ") + (deptEntries.length > 4 ? " and more." : "."), color:"#06b6d4" });
  }

  if (totalCost > 0) {
    var avgCost = (totalCost / Math.max(1, done.length)).toFixed(2);
    funFacts.push({ emoji:"💰", fact: fmtAUD(totalCost) + " material cost", sub: "Total estimated filament cost this term. Average per job: $" + avgCost + " AUD.", color:"#f59e0b" });
  }

  return <div>
    <div style={{ textAlign:"center", marginBottom:28 }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900, letterSpacing:"-0.03em", marginBottom:6 }}>Print Lab Stats</div>
      <div style={{ fontSize:13, color:"#64748b" }}>What we have made together this term</div>
    </div>
    <div className="g4" style={{ marginBottom:28 }}>
      <StatCard emoji="🖨️" value={""+all3D.length} label="3D Print Jobs" color="#f97316"/>
      <StatCard emoji="🔴" value={""+allLaser.length} label="Laser/Cut Jobs" color="#a855f7"/>
      <StatCard emoji="📦" value={""+totalPieces} label="Pieces Made" color="#3b82f6"/>
      <StatCard emoji="💰" value={fmtAUD(totalCost)} label="Est. Material Cost" color="#f59e0b"/>
    </div>
    {funFacts.length > 0 ? <div>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:800, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
        <span>✨ Fun Facts</span>
        <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", color:"#64748b", fontWeight:400 }}>({funFacts.length} stats)</span>
      </div>
      <div className="g3" style={{ marginBottom:28 }}>
        {funFacts.map(function(f,i) {
          return <div key={i} style={{ background:"#1e293b", border:"1px solid #111827", borderRadius:12, padding:16, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ fontSize:26 }}>{f.emoji}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13, color:f.color||"#e2e8f0", lineHeight:1.3 }}>{f.fact}</div>
            <div style={{ fontSize:10, color:"#64748b", lineHeight:1.65 }}>{f.sub}</div>
          </div>;
        })}
      </div>
    </div> : <div style={{ textAlign:"center", padding:"24px 0 16px", color:"#475569" }}>
      <div style={{ fontSize:36, marginBottom:8, opacity:0.2 }}>✨</div>
      <div style={{ fontSize:13 }}>Fun facts will appear as jobs are completed</div>
    </div>}
    {done.slice(0,6).length > 0 && <div>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:800, marginBottom:14 }}>Recently Completed</div>
      <div style={{ background:"#1e293b", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
        {done.slice(0,6).map(function(r,i) {
          var isLaser = r.jobCategory === "laser";
          return <div key={r.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"12px 16px", borderBottom:i<5?"1px solid #080d16":"none" }}>
            <div style={{ width:36, height:36, borderRadius:8, background:isLaser?"rgba(168,85,247,0.1)":"rgba(249,115,22,0.1)", border:"1px solid "+(isLaser?"rgba(168,85,247,0.2)":"rgba(249,115,22,0.2)"), display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{isLaser?"🔴":"✅"}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.projectName}</div>
              <div style={{ fontSize:10, color:"#64748b" }}>{r.teacherName}{r.department ? " — " + r.department : ""}</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontSize:11, color:isLaser?"#a855f7":"#f97316" }}>{isLaser ? (r.jobType||"Laser") : r.material + " — " + r.color}</div>
              <div style={{ fontSize:9, color:"#475569" }}>{new Date(r.submittedAt).toLocaleDateString("en-AU",{day:"numeric",month:"short"})}</div>
            </div>
          </div>;
        })}
      </div>
    </div>}
    {done.length === 0 && <div style={{ textAlign:"center", padding:"40px 0", color:"#475569" }}>
      <div style={{ fontSize:44, marginBottom:12, opacity:0.15 }}>🖨️</div>
      <div style={{ fontSize:14 }}>No completed jobs yet — stats will fill up as the lab gets busy!</div>
    </div>}
  </div>;
}

// ─── Monthly Report ───────────────────────────────────────────────────────────
function MonthlyReport({ requests }) {
  var sm=useState(new Date().getMonth()); var selMonth=sm[0],setSelMonth=sm[1];
  var sy=useState(new Date().getFullYear()); var selYear=sy[0],setSelYear=sy[1];
  var monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
  var filtered=requests.filter(function(r){var d=new Date(r.submittedAt);return d.getMonth()===selMonth&&d.getFullYear()===selYear;});
  var done=filtered.filter(function(r){return r.status==="Done";});
  var f3d=filtered.filter(function(r){return r.jobCategory!=="laser";});
  var fLaser=filtered.filter(function(r){return r.jobCategory==="laser";});
  var done3d=done.filter(function(r){return r.jobCategory!=="laser";});
  var doneLaser=done.filter(function(r){return r.jobCategory==="laser";});
  var totalFilG=done3d.reduce(function(a,r){return a+(r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity));},0);
  var totalCost=done.reduce(function(a,r){return a+(r.estimatedCostAUD||0);},0);

  // Dept breakdown for all types
  var byDept={};
  filtered.forEach(function(r){
    var d=r.department||"General";
    if(!byDept[d])byDept[d]={dept:d,total:0,prints:0,laser:0,cost:0,filamentG:0};
    byDept[d].total++;
    if(r.jobCategory==="laser")byDept[d].laser++;
    else{byDept[d].prints++;byDept[d].filamentG+=r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity);}
    byDept[d].cost+=r.estimatedCostAUD||0;
  });
  var deptRows=Object.values(byDept).sort(function(a,b){return b.total-a.total;});

  // Laser job types for the period
  var laserTypes={};fLaser.forEach(function(r){var jt=r.jobType||"Engrave";laserTypes[jt]=(laserTypes[jt]||0)+1;});

  function printReport(){window.print();}

  var tdStyle={padding:"10px",fontSize:12,color:"#94a3b8",borderBottom:"1px solid #162032"};
  var tdH={padding:"10px",fontSize:12,color:"#f1f5f9",borderBottom:"1px solid #162032"};

  return <div>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
      <div style={{ fontSize:20, fontWeight:600 }}>Monthly Report</div>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <select value={selMonth} onChange={function(e){setSelMonth(parseInt(e.target.value));}} style={Object.assign({},selectStyle,{width:"auto",padding:"6px 12px",fontSize:12})}>
          {monthNames.map(function(m,i){return <option key={i} value={i}>{m}</option>;})}
        </select>
        <select value={selYear} onChange={function(e){setSelYear(parseInt(e.target.value));}} style={Object.assign({},selectStyle,{width:"auto",padding:"6px 12px",fontSize:12})}>
          {[2024,2025,2026,2027].map(function(y){return <option key={y}>{y}</option>;})}
        </select>
        <button onClick={printReport} className="bh" style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:7, padding:"7px 14px", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>Print</button>
      </div>
    </div>

    {/* Header block */}
    <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:20, marginBottom:16 }}>
      <div style={{ fontSize:16, fontWeight:600, marginBottom:4 }}>MACC Digital Fabrication Lab — {monthNames[selMonth]} {selYear}</div>
      <div style={{ fontSize:12, color:"#64748b" }}>Generated {new Date().toLocaleDateString("en-AU",{day:"numeric",month:"long",year:"numeric"})}</div>
    </div>

    {/* Overview */}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
      <StatCard emoji="🖨️" value={""+f3d.length} label="3D Print Requests" color="#f97316"/>
      <StatCard emoji="🔴" value={""+fLaser.length} label="Laser/Cut Requests" color="#a855f7"/>
      <StatCard emoji="📋" value={""+filtered.length} label="Total Requests" color="#64748b"/>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
      <StatCard emoji="✅" value={""+done3d.length} label="3D Completed" color="#22c55e"/>
      <StatCard emoji="✅" value={""+doneLaser.length} label="Laser Completed" color="#22c55e"/>
      <StatCard emoji="💰" value={fmtAUD(totalCost)} label="Material Cost" color="#f59e0b"/>
    </div>

    {/* 3D Print summary */}
    {f3d.length>0&&<Card title="3D Printing Summary">
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
        <div style={{ background:"#162032", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>Submitted</div>
          <div style={{ fontSize:22, fontWeight:600, color:"#f97316" }}>{f3d.length}</div>
        </div>
        <div style={{ background:"#162032", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>Completed</div>
          <div style={{ fontSize:22, fontWeight:600, color:"#22c55e" }}>{done3d.length}</div>
        </div>
        <div style={{ background:"#162032", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>Filament Used</div>
          <div style={{ fontSize:22, fontWeight:600, color:"#f97316" }}>{(totalFilG/1000).toFixed(2)}kg</div>
        </div>
      </div>
    </Card>}

    {/* Laser summary */}
    {fLaser.length>0&&<Card title="Laser / Cut Summary" style={{ marginTop:16 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
        <div style={{ background:"#162032", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>Submitted</div>
          <div style={{ fontSize:22, fontWeight:600, color:"#a855f7" }}>{fLaser.length}</div>
        </div>
        <div style={{ background:"#162032", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>Completed</div>
          <div style={{ fontSize:22, fontWeight:600, color:"#22c55e" }}>{doneLaser.length}</div>
        </div>
        <div style={{ background:"#162032", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>Job Types</div>
          <div style={{ fontSize:11, color:"#a78bfa", lineHeight:1.8 }}>
            {Object.entries(laserTypes).map(function(e){return <div key={e[0]}>{e[0]}: {e[1]}</div>;})}
          </div>
        </div>
      </div>
    </Card>}

    {/* Dept table */}
    {deptRows.length>0&&<Card title="Usage by Department">
      <div style={{ overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr>{["Department","Total","3D Jobs","Laser Jobs","Filament","Cost"].map(function(h){
          return <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:600, color:"#64748b", borderBottom:"1px solid #334155" }}>{h}</th>;
        })}</tr></thead>
        <tbody>{deptRows.map(function(d,i){return <tr key={d.dept} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
          <td style={tdH}>{d.dept}</td>
          <td style={tdStyle}>{d.total}</td>
          <td style={Object.assign({},tdStyle,{color:"#fb923c"})}>{d.prints}</td>
          <td style={Object.assign({},tdStyle,{color:"#a78bfa"})}>{d.laser}</td>
          <td style={Object.assign({},tdStyle,{color:"#94a3b8"})}>{d.filamentG.toFixed(0)}g</td>
          <td style={Object.assign({},tdStyle,{color:"#fbbf24"})}>{fmtAUD(d.cost)}</td>
        </tr>;})}
        </tbody>
      </table></div>
    </Card>}

    {filtered.length===0&&<div style={{ textAlign:"center", padding:"40px 0", color:"#475569" }}>
      <div style={{ fontSize:36, opacity:0.15, marginBottom:10 }}>📊</div>
      <div>No requests for {monthNames[selMonth]} {selYear}</div>
    </div>}
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
        <div style={{ fontSize:12, color:"#64748b" }}>{inv.filter(function(f){return f.enabled;}).length} active — {inv.filter(function(f){return f.custom;}).length} custom — Est. value: <span style={{ color:"#22c55e" }}>{fmtAUD(totalVal)}</span></div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        {shopList.length>0&&<button onClick={function(){sendShoppingEmail(shopList,admin);}} className="bh" style={{ background:"#d97706", color:"#fff", border:"none", borderRadius:8, padding:"10px 16px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase" }}>Shopping List ({shopList.length})</button>}
        <button onClick={openAdd} className="bh" style={{ background:"#ea580c", color:"#fff", border:"none", borderRadius:8, padding:"10px 16px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase" }}>+ Add Filament</button>
      </div>
    </div>
    {showForm&&<div style={{ background:"#1e293b", border:"1px solid rgba(249,115,22,0.25)", borderRadius:14, padding:20, marginBottom:20 }}>
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
        <div><div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{form.type} — {form.colorName}</div><div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>{form.material} — {fmtAUD(parseFloat(form.priceAUD)||0)}/spool — {form.spoolsOwned} spool(s)</div></div>
        <div style={{ marginLeft:"auto", fontSize:10, color:"#64748b", fontFamily:"'DM Mono',monospace" }}>{form.hex}</div>
      </div>}
      {formErr&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"9px 12px", fontSize:12, color:"#ef4444", marginBottom:12 }}>{formErr}</div>}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={submitForm} className="bh" style={{ flex:1, background:"#ea580c", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>{editId?"Save Changes":"Add to Inventory"}</button>
        <button onClick={cancelForm} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:8, padding:"11px 20px", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>}
    {shopList.length>0&&<div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:12, padding:16, marginBottom:20 }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14, color:"#ef4444", marginBottom:10 }}>⚠️ Running Low — Reorder Needed</div>
      {shopList.map(function(f){return <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, background:"rgba(239,68,68,0.05)", borderRadius:8, padding:"10px 12px", marginBottom:6 }}>
        <div style={{ width:28, height:28, borderRadius:"50%", background:f.hex, border:"2px solid rgba(239,68,68,0.3)", flexShrink:0 }}/>
        <div style={{ flex:1 }}><div style={{ fontSize:12, color:"#e2e8f0" }}>{f.type} — {f.color}</div><div style={{ fontSize:10, color:"#ef4444" }}>{f.remainingG.toFixed(0)}g remaining</div></div>
        <div style={{ textAlign:"right" }}><div style={{ fontSize:11, color:"#f59e0b" }}>Order {f.suggestSpools} spool(s)</div><div style={{ fontSize:10, color:"#64748b" }}>{fmtAUD(f.suggestSpools*f.price)}</div></div>
      </div>;})}
    </div>}
    {delConfirm&&<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, backdropFilter:"blur(4px)" }}>
      <div style={{ background:"#1e293b", border:"1px solid rgba(239,68,68,0.3)", borderRadius:14, padding:24, maxWidth:380, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🗑️</div>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, marginBottom:8 }}>Delete this filament?</div>
        <div style={{ fontSize:12, color:"#64748b", marginBottom:6 }}>{delConfirm.type} — {delConfirm.color}</div>
        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button onClick={function(){delFil(delConfirm.id);}} className="bh" style={{ flex:1, background:"#ef4444", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", textTransform:"uppercase" }}>Delete</button>
          <button onClick={function(){setDelConfirm(null);}} style={{ flex:1, background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:8, padding:"11px 0", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>Cancel</button>
        </div>
      </div>
    </div>}
    <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:16 }}>
      {allTypes.map(function(t){return <button key={t} onClick={function(){setFilter(t);}} className="bh" style={{ background:filter===t?"#f97316":"transparent", color:filter===t?"#fff":"#64748b", border:"1px solid "+(filter===t?"#f97316":"#334155"), borderRadius:5, padding:"5px 11px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer", letterSpacing:"0.06em", textTransform:"uppercase" }}>{t}</button>;})}
    </div>
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {groupEntries.map(function(entry){
        var type=entry[0],items=entry[1];
        return <div key={type} style={{ background:"#1e293b", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
          <div style={{ padding:"10px 15px", borderBottom:"1px solid #111827", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13, color:"#e2e8f0" }}>{type}</span>
            {items[0].custom&&<span style={{ fontSize:8, background:"rgba(168,85,247,0.15)", color:"#a855f7", borderRadius:4, padding:"2px 7px" }}>CUSTOM</span>}
            <span style={{ fontSize:10, color:"#64748b" }}>{items[0].material} — {fmtAUD(items[0].price)}/spool</span>
          </div>
          {items.map(function(f,i){
            var rem=getRem(f),pct=Math.min(100,rem/Math.max(1,(f.spoolsOwned||0)*SPOOL_G)*100);
            var st=getStockStatus(f),ss=STATUS_STYLE[st];
            var barBg=st==="ok"?"#22c55e":st==="low"?"#f59e0b":"#ef4444";
            return <div key={f.id} style={{ padding:"11px 15px", borderBottom:i<items.length-1?"1px solid #080d16":"none", opacity:f.enabled?1:0.5 }}>
              <div style={{ display:"grid", gridTemplateColumns:"38px 1fr 200px auto", alignItems:"center", gap:12 }}>
                <div style={{ position:"relative", width:32, height:32, borderRadius:8, background:f.hex, border:"2px solid #1a2035", flexShrink:0, boxShadow:hexIsLight(f.hex)?"inset 0 0 0 1px rgba(0,0,0,0.15)":"none" }}>
                  <div style={{ position:"absolute", bottom:-4, right:-4, background:"#162032", borderRadius:3, padding:"0px 3px", fontSize:7, color:"#64748b", fontFamily:"'DM Mono',monospace", border:"1px solid #1a2035" }}>{f.hex}</div>
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ fontSize:13, color:f.enabled?"#e2e8f0":"#64748b", fontWeight:500 }}>{f.color}</span>{f.custom&&<span style={{ fontSize:8, color:"#a855f7", background:"rgba(168,85,247,0.1)", borderRadius:3, padding:"1px 5px" }}>custom</span>}</div>
                  <div style={{ fontSize:9, color:"#475569", marginTop:1 }}>{f.enabled?"Available to teachers":"Hidden from teachers"}</div>
                </div>
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}><span style={{ fontSize:10, color:"#64748b" }}>{rem.toFixed(0)}g / {(f.spoolsOwned||0)*SPOOL_G}g</span><span style={{ fontSize:9, background:ss.bg, color:ss.color, borderRadius:3, padding:"1px 5px" }}>{ss.label}</span></div>
                  <div style={{ height:5, background:"#334155", borderRadius:3 }}><div style={{ width:pct+"%", height:"100%", background:barBg, borderRadius:3, transition:"width .3s" }}/></div>
                </div>
                <div style={{ display:"flex", gap:5, alignItems:"center", justifyContent:"flex-end" }}>
                  {restockId===f.id?<div style={{ display:"flex", gap:4, alignItems:"center" }}>
                    <input type="number" min={1} max={20} value={restockQty} onChange={function(e){setRestockQty(parseInt(e.target.value)||1);}} style={{ width:46, background:"#0f172a", border:"1px solid #1a2035", borderRadius:5, padding:"4px 6px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:11, outline:"none" }}/>
                    <button onClick={function(){restock(f.id);}} style={{ background:"#22c55e", color:"#fff", border:"none", borderRadius:5, padding:"4px 8px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>Add</button>
                    <button onClick={function(){setRestockId(null);}} style={{ background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:5, padding:"4px 6px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>x</button>
                  </div>:<button onClick={function(){setRestockId(f.id);setRestockQty(1);}} style={{ background:"transparent", color:"#22c55e", border:"1px solid rgba(34,197,94,0.3)", borderRadius:5, padding:"4px 9px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer", whiteSpace:"nowrap" }}>+ Stock</button>}
                  <button onClick={function(){toggle(f.id);}} className="bh" style={{ background:f.enabled?"rgba(249,115,22,0.1)":"rgba(75,85,99,0.1)", color:f.enabled?"#f97316":"#64748b", border:"1px solid "+(f.enabled?"rgba(249,115,22,0.3)":"rgba(75,85,99,0.3)"), borderRadius:5, padding:"4px 9px", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer" }}>{f.enabled?"Active":"Hidden"}</button>
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
  var r3d = requests.filter(function(r){return r.jobCategory!=="laser";});
  var rLaser = requests.filter(function(r){return r.jobCategory==="laser";});

  // Per-department (all job types combined)
  var byDept={};
  requests.forEach(function(r){
    var d=r.department||"General";
    if(!byDept[d])byDept[d]={dept:d,total:0,prints:0,laser:0,pieces:0,cost:0,filamentG:0,laserJobs:0};
    byDept[d].total++;
    if(r.jobCategory==="laser"){byDept[d].laser++;byDept[d].laserJobs++;}
    else{byDept[d].prints++;byDept[d].pieces+=r.quantity;byDept[d].filamentG+=r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity);}
    byDept[d].cost+=r.estimatedCostAUD||0;
  });
  var deptData=Object.values(byDept).sort(function(a,b){return b.total-a.total;});

  // Per-teacher
  var byPerson={};
  requests.forEach(function(r){
    var k=r.teacherName;
    if(!byPerson[k])byPerson[k]={name:k,dept:r.department||"General",total:0,prints:0,laser:0,pieces:0,cost:0,filamentG:0};
    byPerson[k].total++;
    if(r.jobCategory==="laser")byPerson[k].laser++;
    else{byPerson[k].prints++;byPerson[k].pieces+=r.quantity;byPerson[k].filamentG+=r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity);}
    byPerson[k].cost+=r.estimatedCostAUD||0;
  });
  var personData=Object.values(byPerson).sort(function(a,b){return b.total-a.total;});

  // Material breakdown (3D only)
  var byMat={};r3d.forEach(function(r){byMat[r.material]=(byMat[r.material]||0)+r.quantity;});
  var matData=Object.entries(byMat).map(function(e){return{name:e[0],value:e[1]};});

  // Laser job type breakdown
  var byLaserType={};rLaser.forEach(function(r){var jt=r.jobType||"Engrave";byLaserType[jt]=(byLaserType[jt]||0)+1;});
  var laserTypeData=Object.entries(byLaserType).map(function(e){return{name:e[0],value:e[1]};});

  // Laser material breakdown
  var byLaserMat={};rLaser.forEach(function(r){var m=r.laserMaterial||"wood";byLaserMat[m]=(byLaserMat[m]||0)+1;});
  var laserMatData=Object.entries(byLaserMat).map(function(e){return{name:e[0],value:e[1]};});

  // Status breakdown
  var byStat={};requests.forEach(function(r){byStat[r.status]=(byStat[r.status]||0)+1;});
  var statData=Object.entries(byStat).map(function(e){return{name:e[0],value:e[1]};});
  var statColors={Pending:"#94a3b8",Queued:"#f59e0b",Printing:"#3b82f6",Done:"#22c55e",Failed:"#ef4444",Cancelled:"#64748b"};

  var totalCost=requests.reduce(function(a,r){return a+(r.estimatedCostAUD||0);},0);
  var totalFilG=r3d.reduce(function(a,r){return a+(r.filamentUsedG||estWeight(r.stlStats,r.material,r.quantity));},0);
  var laserDone=rLaser.filter(function(r){return r.status==="Done";}).length;
  var ttS={background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#f1f5f9"};

  return <div>
    <div style={{ fontSize:22, fontWeight:600, marginBottom:20 }}>Insights</div>

    {/* Overview stat cards */}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:12 }}>
      <StatCard emoji="🖨️" value={""+r3d.length} label="3D Print Requests" color="#f97316"/>
      <StatCard emoji="🔴" value={""+rLaser.length} label="Laser/Cut Requests" color="#a855f7"/>
      <StatCard emoji="📋" value={""+requests.length} label="All Requests" color="#64748b"/>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:24 }}>
      <StatCard emoji="🧶" value={(totalFilG/1000).toFixed(2)+"kg"} label="3D Filament Used" color="#f97316"/>
      <StatCard emoji="✅" value={""+laserDone} label="Laser Jobs Done" color="#a855f7"/>
      <StatCard emoji="💰" value={fmtAUD(totalCost)} label="Total Material Cost" color="#f59e0b"/>
    </div>

    {requests.length===0
      ?<div style={{ textAlign:"center", padding:"60px 0", color:"#475569" }}><div style={{ fontSize:44, marginBottom:12, opacity:0.15 }}>📊</div><div style={{ fontSize:14 }}>Insights will appear as requests come in</div></div>
      :<div style={{ display:"flex", flexDirection:"column", gap:20 }}>

        {/* 3D Print section */}
        <div style={{ borderLeft:"3px solid #f97316", paddingLeft:14 }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#f97316", marginBottom:12 }}>3D Printing</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            <Card title="3D Jobs by Department">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={deptData.filter(function(d){return d.prints>0;})} margin={{top:0,right:0,left:-20,bottom:0}}>
                  <XAxis dataKey="dept" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={ttS} cursor={{fill:"rgba(249,115,22,0.06)"}}/>
                  <Bar dataKey="prints" fill="#f97316" radius={[4,4,0,0]} name="3D Jobs"/>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Filament Material Mix">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart><Pie data={matData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" label={function(e){return e.name;}}>
                  {matData.map(function(e,i){return <Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>;})}</Pie>
                  <Tooltip contentStyle={ttS}/>
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </div>

        {/* Laser section */}
        {rLaser.length>0&&<div style={{ borderLeft:"3px solid #7c3aed", paddingLeft:14 }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#a78bfa", marginBottom:12 }}>Laser / Cut</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            <Card title="Laser Jobs by Department">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={deptData.filter(function(d){return d.laser>0;})} margin={{top:0,right:0,left:-20,bottom:0}}>
                  <XAxis dataKey="dept" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={ttS} cursor={{fill:"rgba(124,58,237,0.06)"}}/>
                  <Bar dataKey="laser" fill="#7c3aed" radius={[4,4,0,0]} name="Laser Jobs"/>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <Card title="Job Type Breakdown">
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={laserTypeData} layout="vertical" margin={{top:0,right:0,left:60,bottom:0}}>
                    <XAxis type="number" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis type="category" dataKey="name" tick={{fill:"#94a3b8",fontSize:10}} axisLine={false} tickLine={false} width={60}/>
                    <Tooltip contentStyle={ttS}/>
                    <Bar dataKey="value" fill="#7c3aed" radius={[0,4,4,0]} name="Jobs"/>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card title="Material Used">
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {laserMatData.map(function(m,i){return <div key={m.name} style={{ background:"rgba(124,58,237,0.1)", border:"1px solid rgba(124,58,237,0.2)", borderRadius:6, padding:"5px 10px", fontSize:11, color:"#d8b4fe" }}>{m.name} <span style={{ color:"#a78bfa", fontWeight:600 }}>{m.value}</span></div>;})}
                </div>
              </Card>
            </div>
          </div>
        </div>}
        {rLaser.length===0&&<div style={{ borderLeft:"3px solid #334155", paddingLeft:14 }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#475569", marginBottom:6 }}>Laser / Cut</div>
          <div style={{ fontSize:12, color:"#334155" }}>No laser jobs submitted yet. Data will appear here once laser requests come in.</div>
        </div>}

        <Card title="Printer Utilisation Calendar">
          <UtilisationCalendar requests={requests}/>
        </Card>

        {/* Queue status */}
        <Card title="Queue Status — All Job Types">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart><Pie data={statData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" label={function(e){return e.name+" ("+e.value+")";}}>
              {statData.map(function(e,i){return <Cell key={i} fill={statColors[e.name]||CHART_COLORS[i]}/>;})}</Pie>
              <Tooltip contentStyle={ttS}/>
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Combined dept table */}
        <Card title="All Requests by Department">
          <div style={{ overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>{["Department","Total","3D Jobs","Laser Jobs","Filament","Cost","Avg/Job"].map(function(h){return <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:600, color:"#64748b", borderBottom:"1px solid #334155" }}>{h}</th>;})}</tr></thead>
            <tbody>{deptData.map(function(d,i){return <tr key={d.dept} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
              <td style={{ padding:"10px", fontSize:12, color:"#f1f5f9", borderBottom:"1px solid #162032" }}>{d.dept}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#94a3b8", borderBottom:"1px solid #162032" }}>{d.total}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#f97316", borderBottom:"1px solid #162032" }}>{d.prints}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#a78bfa", borderBottom:"1px solid #162032" }}>{d.laser}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#94a3b8", borderBottom:"1px solid #162032" }}>{d.filamentG.toFixed(0)}g</td>
              <td style={{ padding:"10px", fontSize:12, color:"#f59e0b", borderBottom:"1px solid #162032" }}>{fmtAUD(d.cost)}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#94a3b8", borderBottom:"1px solid #162032" }}>{fmtAUD(d.cost/(d.total||1))}</td>
            </tr>;})}
            </tbody>
          </table></div>
        </Card>

        {/* Per-teacher table */}
        <Card title="Per-Teacher Breakdown">
          <div style={{ overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>{["Teacher","Department","3D","Laser","Filament","Cost"].map(function(h){return <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:600, color:"#64748b", borderBottom:"1px solid #334155" }}>{h}</th>;})}</tr></thead>
            <tbody>{personData.map(function(p,i){return <tr key={p.name} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
              <td style={{ padding:"10px", fontSize:12, color:"#f1f5f9", borderBottom:"1px solid #162032" }}>{p.name}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#94a3b8", borderBottom:"1px solid #162032" }}>{p.dept}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#f97316", borderBottom:"1px solid #162032" }}>{p.prints}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#a78bfa", borderBottom:"1px solid #162032" }}>{p.laser}</td>
              <td style={{ padding:"10px", fontSize:12, color:"#94a3b8", borderBottom:"1px solid #162032" }}>{p.filamentG.toFixed(0)}g</td>
              <td style={{ padding:"10px", fontSize:12, color:"#f59e0b", borderBottom:"1px solid #162032" }}>{fmtAUD(p.cost)}</td>
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
    <div style={{ width:"100%", maxWidth:560, background:"#1e293b", border:"1px solid #111827", borderRadius:16, overflow:"hidden", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
      <div style={{ borderBottom:"1px solid #111827", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15 }}>📋 Saved Templates</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18 }}>×</button>
      </div>
      <div style={{ padding:20, overflowY:"auto" }}>
        {templates.length===0?<div style={{ textAlign:"center", padding:"32px 0", color:"#64748b" }}><div style={{ fontSize:32, marginBottom:10 }}>📭</div>No saved templates yet. Submit a print request and save it as a template for quick reuse!</div>
        :<div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {templates.map(function(t){return <div key={t.id} style={{ background:"#162032", border:"1px solid #111827", borderRadius:10, padding:"12px 15px", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{t.projectName}</div>
              <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>{t.material} — {t.color} — x{t.quantity} — {t.department||"No dept"}</div>
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

// ─── FilamentPicker — inventory-driven material + colour selector ─────────────
var MAT_META = {
  PLA:  { emoji:"🟢", desc:"Safe, affordable and easy to print. Best for most classroom projects.", color:"#22c55e" },
  PETG: { emoji:"💧", desc:"Tougher than PLA and slightly water-resistant. Good for durable parts.", color:"#3b82f6" },
  ABS:  { emoji:"⚙️", desc:"Very strong and heat-resistant. Best for functional parts.", color:"#f59e0b" },
  TPU:  { emoji:"🤸", desc:"Bendy and rubbery — great for phone cases, grips and flex parts.", color:"#a855f7" }
};

function FilamentPicker({ inv, form, setForm }) {
  // Only show filaments that are enabled and have stock remaining
  var inStock = inv.filter(function(f) {
    return f.enabled && getRem(f) > 0;
  });

  // Get unique materials that have at least one in-stock colour
  var availableMaterials = [];
  var seen = {};
  inStock.forEach(function(f) {
    if (!seen[f.material]) { seen[f.material] = true; availableMaterials.push(f.material); }
  });

  // Colours available for the currently selected material
  var availableColours = inStock.filter(function(f) {
    return f.material === form.material;
  });

  // If current material has no stock, reset it
  if (form.material && availableMaterials.indexOf(form.material) < 0 && availableMaterials.length > 0) {
    setForm(function(f) { return Object.assign({}, f, { material: availableMaterials[0], color: "", filamentId: "" }); });
  }

  // If current colour is no longer valid for selected material, reset it
  var colourValid = availableColours.some(function(f) { return f.color === form.color; });
  if (form.color && !colourValid && availableColours.length > 0) {
    setForm(function(f) { return Object.assign({}, f, { color: "", filamentId: "" }); });
  }

  function selectMaterial(mat) {
    setForm(function(f) { return Object.assign({}, f, { material: mat, color: "", filamentId: "" }); });
  }

  function selectColour(fil) {
    setForm(function(f) { return Object.assign({}, f, { color: fil.color, filamentId: fil.id }); });
  }

  if (inStock.length === 0) {
    return <div style={{ background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:12, padding:"20px 16px", textAlign:"center" }}>
      <div style={{ fontSize:28, marginBottom:8 }}>⚠️</div>
      <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, color:"#ef4444", marginBottom:6 }}>No Filament in Stock</div>
      <div style={{ fontSize:12, color:"#64748b" }}>The admin needs to update the filament inventory before requests can be submitted.</div>
    </div>;
  }

  var selMeta = MAT_META[form.material] || {};

  return <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
    {/* Step A — Pick material */}
    <Card title="Choose a material">
      <div className="g2s" style={{ gap:10 }}>
        {availableMaterials.map(function(mat) {
          var meta = MAT_META[mat] || { emoji:"🧱", desc:"", color:"#94a3b8" };
          var sel = form.material === mat;
          var colours = inStock.filter(function(f) { return f.material === mat; });
          return <div key={mat} className="mc" onClick={function() { selectMaterial(mat); }} style={{ border:"2px solid "+(sel?meta.color:"#334155"), borderRadius:10, padding:12, background:sel?meta.color+"12":"#162032", position:"relative", cursor:"pointer" }}>
            <div style={{ fontSize:20, marginBottom:4 }}>{meta.emoji}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:sel?meta.color:"#e2e8f0", marginBottom:4 }}>{mat}</div>
            <div style={{ fontSize:10, color:"#64748b", lineHeight:1.6, marginBottom:6 }}>{meta.desc}</div>
            <div style={{ fontSize:9, color:sel?meta.color:"#64748b", letterSpacing:"0.06em" }}>{colours.length} colour{colours.length!==1?"s":""} in stock</div>
          </div>;
        })}
      </div>
    </Card>

    {/* Step B — Pick colour for that material */}
    {form.material && availableColours.length > 0 && <Card title={"Choose a colour — " + availableColours.length + " available for " + form.material}>
      <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
        {availableColours.map(function(fil) {
          var sel = form.color === fil.color && form.material === fil.material;
          var rem = getRem(fil);
          var isLow = rem <= LOW_G;
          return <div key={fil.id} className="cs" onClick={function() { selectColour(fil); }} title={fil.color + " (" + rem.toFixed(0) + "g remaining)"} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, cursor:"pointer", position:"relative" }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:fil.hex, border:"3px solid "+(sel?"#f97316":"transparent"), boxShadow:sel?"0 0 14px rgba(249,115,22,0.6)":"none", transition:"all .15s", position:"relative" }}>
              {isLow && <div style={{ position:"absolute", top:-2, right:-2, width:12, height:12, borderRadius:"50%", background:"#f59e0b", border:"2px solid #050810", display:"flex", alignItems:"center", justifyContent:"center", fontSize:7 }}>!</div>}
            </div>
            <div style={{ fontSize:9, color:sel?"#f97316":"#94a3b8", fontWeight:sel?500:400, textAlign:"center", maxWidth:48 }}>{fil.color}</div>
            {isLow && <div style={{ fontSize:8, color:"#f59e0b", marginTop:-2 }}>Low stock</div>}
          </div>;
        })}
      </div>
      {form.color && <div style={{ display:"flex", alignItems:"center", gap:12, background:"rgba(249,115,22,0.06)", border:"1px solid rgba(249,115,22,0.15)", borderRadius:8, padding:"10px 14px", marginTop:4 }}>
        {(function() {
          var sel = availableColours.find(function(f) { return f.color === form.color; });
          if (!sel) return null;
          return <>
            <div style={{ width:32, height:32, borderRadius:"50%", background:sel.hex, flexShrink:0, border:"2px solid rgba(249,115,22,0.3)" }}/>
            <div>
              <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{sel.type} — {sel.color}</div>
              <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>
                {getRem(sel).toFixed(0)}g remaining — {fmtAUD(sel.price)}/spool
              </div>
            </div>
            <div style={{ marginLeft:"auto", fontSize:9, color:"#64748b", fontFamily:"'DM Mono',monospace" }}>{sel.hex}</div>
          </>;
        })()}
      </div>}
    </Card>}
  </div>;
}

// ─── Laser / Cut Wizard ───────────────────────────────────────────────────────
function LaserWizard({ form, setForm, step, setStep, submitted, confetti, laserFile, setLaserFile, lfileRef, onSubmit, requests, setFileData, setDims, fileData, dims }) {
  var lfileDropRef = useRef(null);

  function handleLaserFile(file) {
    if (!file) return;
    var ext = file.name.split(".").pop().toLowerCase();
    var ok = ["svg","png","pdf","dxf","jpg","jpeg"].indexOf(ext) >= 0;
    if (!ok) { alert("Please upload an SVG, PNG, PDF, DXF or JPG file."); return; }
    setLaserFile(file);
    if (!form.projectName) {
      var name = file.name.replace(/\.[^.]+$/, "").replace(/[_.]+/g," ").replace(/[-]+/g," ").split(" ").map(function(w){return w.length>0?w.charAt(0).toUpperCase()+w.slice(1).toLowerCase():w;}).join(" ").trim();
      setForm(function(f) { return Object.assign({}, f, { projectName: name }); });
    }
    // Store file as base64 if small enough + parse SVG dimensions
    if (file.size <= MAX_STORE_BYTES) {
      fileToBase64(file).then(function(b64) { if(setFileData) setFileData(b64); });
    } else {
      if(setFileData) setFileData(null);
    }
    if (ext === "svg") {
      var reader = new FileReader();
      reader.onload = function(e) {
        var d = parseSVGDimensions(e.target.result);
        if(setDims) setDims(d);
      };
      reader.readAsText(file);
    } else {
      if(setDims) setDims(null);
    }
  }

  function onLaserDrop(e) {
    e.preventDefault();
    if (lfileDropRef.current) lfileDropRef.current.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleLaserFile(e.dataTransfer.files[0]);
  }

  var warnings = getLaserWarnings(form);
  var hasErrors = warnings.filter(function(w) { return w.type === "error"; }).length > 0;
  var estTime = getLaserEstTime(form);

  var selMat = null;
  for (var i = 0; i < LASER_MATERIALS.length; i++) { if (LASER_MATERIALS[i].id === form.laserMaterial) { selMat = LASER_MATERIALS[i]; break; } }
  var selJob = null;
  for (var j = 0; j < LASER_JOB_TYPES.length; j++) { if (LASER_JOB_TYPES[j].id === form.jobType) { selJob = LASER_JOB_TYPES[j]; break; } }

  var lq = requests.filter(function(r) { return r.jobCategory === "laser" && (r.status === "Queued" || r.status === "Printing"); }).length;

  if (submitted) {
    return <div style={{ textAlign:"center", padding:"80px 0" }}>
      {confetti && <Confetti/>}
      <div className="ci" style={{ fontSize:80, marginBottom:16 }}>🔴</div>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900, color:"#a855f7" }}>Laser job submitted!</div>
      <div style={{ color:"#64748b", marginTop:10, fontSize:14, lineHeight:1.8 }}>Your request is in the laser queue.<br/>The admin will be in touch when it's ready to start.</div>
      {lq > 0 && <div style={{ marginTop:16, background:"rgba(168,85,247,0.08)", border:"1px solid rgba(168,85,247,0.2)", borderRadius:10, padding:"12px 20px", display:"inline-block" }}>
        <div style={{ fontSize:10, color:"#a855f7", letterSpacing:"0.1em", marginBottom:4 }}>JOBS AHEAD IN LASER QUEUE</div>
        <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:"#a855f7" }}>{lq}</div>
      </div>}
    </div>;
  }

  return <div style={{ maxWidth:720, margin:"0 auto" }}>
    {/* Header */}
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
        <div style={{ width:44, height:44, borderRadius:10, background:"rgba(168,85,247,0.15)", border:"1px solid rgba(168,85,247,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>🔴</div>
        <div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, letterSpacing:"-0.03em" }}>
            {["Laser/Cut Request","Job Options","Review & Submit"][step]}
          </div>
          <div style={{ fontSize:11, color:"#64748b" }}>
            {["Upload your design file and tell us who you are.","Choose your job type, material and settings.","Everything look right? Hit submit!"][step]}
          </div>
        </div>
      </div>
      <div style={{ background:"rgba(168,85,247,0.06)", border:"1px solid rgba(168,85,247,0.15)", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#a855f7", lineHeight:1.7 }}>
        <strong>Bambu Lab H2D</strong> — 40W blue laser (455nm), working area 310×250mm, cuts up to 15mm timber. Also supports vinyl blade cutting and pen drawing.
      </div>
    </div>

    <StepBar step={step} steps={["Your Details","Job Options","Review"]}/>

    {/* ── Step 0: Details + File ── */}
    {step===0&&<div className="fu" style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <Card title="Your details">
        <div className="g2s">
          <div><Lbl>Your name</Lbl><input value={form.teacherName} placeholder="e.g. Ms. Johnson" onChange={function(e){setForm(function(f){return Object.assign({},f,{teacherName:e.target.value});});}} style={baseInput}/></div>
          <div><Lbl>School email</Lbl><input value={form.email} placeholder="you@macc.nsw.edu.au" onChange={function(e){setForm(function(f){return Object.assign({},f,{email:e.target.value});});}} style={baseInput}/></div>
        </div>
        <div><Lbl>Department</Lbl>
          <select value={form.department} onChange={function(e){setForm(function(f){return Object.assign({},f,{department:e.target.value});});}} style={selectStyle}>
            <option value="">— Select your department —</option>
            {DEPARTMENTS.map(function(d){return <option key={d} value={d}>{d}</option>;})}
          </select>
        </div>
      </Card>

      <Card title="Upload Your Design File">
        <div style={{ background:"rgba(168,85,247,0.05)", border:"1px solid rgba(168,85,247,0.15)", borderRadius:8, padding:"10px 12px", fontSize:11, color:"#9ca3af", lineHeight:1.7 }}>
          <strong style={{ color:"#d8b4fe" }}>Accepted formats:</strong> SVG (recommended), PNG, JPG, PDF, DXF. SVG gives the cleanest results for cutting. Design in Bambu Suite, Inkscape, Canva or similar.
        </div>
        <div>
          <Lbl>Source URL (optional)</Lbl>
          <div style={{ position:"relative" }}>
            <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, pointerEvents:"none", opacity:0.4 }}>🔗</div>
            <input value={form.sourceUrl} onChange={function(e){setForm(function(f){return Object.assign({},f,{sourceUrl:e.target.value});});}} placeholder="Link to design source (optional)" style={Object.assign({},baseInput,{paddingLeft:34,fontSize:12})}/>
          </div>
        </div>
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <Lbl>Design File *</Lbl>
            <button className="bh" onClick={function(){if(lfileRef.current)lfileRef.current.click();}} style={{ background:"rgba(168,85,247,0.12)", color:"#a855f7", border:"1px solid rgba(168,85,247,0.3)", borderRadius:6, padding:"4px 12px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.06em", textTransform:"uppercase" }}>📂 Browse Files</button>
          </div>
          <div ref={lfileDropRef}
            onDragOver={function(e){e.preventDefault();if(lfileDropRef.current)lfileDropRef.current.classList.add("drag-over");}}
            onDragLeave={function(){if(lfileDropRef.current)lfileDropRef.current.classList.remove("drag-over");}}
            onDrop={onLaserDrop}
            onClick={function(){if(lfileRef.current)lfileRef.current.click();}}
            style={{ border:"2px dashed", borderColor:laserFile?"#a855f7":"#475569", borderRadius:12, padding:"28px 24px", textAlign:"center", cursor:"pointer", background:laserFile?"rgba(168,85,247,0.04)":"transparent", transition:"all .2s" }}>
            <input ref={lfileRef} type="file" accept=".svg,.png,.jpg,.jpeg,.pdf,.dxf" style={{ display:"none" }} onChange={function(e){if(e.target.files&&e.target.files[0])handleLaserFile(e.target.files[0]);}}/>
            {laserFile?<div style={{ width:"100%", textAlign:"left" }}>
              {fileData&&(laserFile.name.toLowerCase().match(/\.(svg|png|jpg|jpeg)$/))&&<div style={{ marginBottom:10, background:"#fff", borderRadius:8, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", minHeight:80, maxHeight:220 }}>
                <img src={fileData} alt="Design preview" style={{ maxWidth:"100%", maxHeight:220, objectFit:"contain" }}/>
              </div>}
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, color:"#a855f7", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{laserFile.name}</div>
                  <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>{(laserFile.size/1024).toFixed(1)} KB{dims?" — "+dims.wMM+"×"+dims.hMM+"mm":""}</div>
                </div>
                <button className="bh" onClick={function(e){e.stopPropagation();if(lfileRef.current)lfileRef.current.click();}} style={{ flexShrink:0, background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:5, padding:"4px 10px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer" }}>Replace</button>
              </div>
              {dims&&(function(){
                var warns=checkLaserWorkArea(dims);
                if(warns.length>0) return <div style={{ marginTop:8, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:7, padding:"8px 12px" }}>{warns.map(function(w,i){return <div key={i} style={{ fontSize:11, color:"#fca5a5" }}>⚠ {w}</div>;})}</div>;
                return <div style={{ marginTop:8, background:"rgba(34,197,94,0.06)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:7, padding:"7px 12px", fontSize:11, color:"#4ade80" }}>✓ Design fits within H2D 40W work area (310×250mm)</div>;
              })()}
            </div>:<div>
              <div style={{ fontSize:44, marginBottom:10, opacity:0.25 }}>📐</div>
              <div style={{ fontSize:14, color:"#64748b", marginBottom:4 }}>Drag your design file here</div>
              <div style={{ fontSize:11, color:"#64748b" }}>SVG, PNG, PDF, DXF, JPG accepted</div>
            </div>}
          </div>
        </div>
      </Card>

      <NavBtns onNext={function(){setStep(1);}} disabled={!form.teacherName||!form.email||!laserFile} label="Choose job options"/>
    </div>}

    {/* ── Step 1: Job Options ── */}
    {step===1&&<div className="fu" style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <Card title="What are you making?">
        <div><Lbl>Project name</Lbl><input value={form.projectName} placeholder='e.g. "Year 9 name tags"' onChange={function(e){setForm(function(f){return Object.assign({},f,{projectName:e.target.value});});}} style={baseInput}/></div>
        <div><Lbl>What is it for? (optional)</Lbl><textarea value={form.purpose} rows={2} placeholder="e.g. CAPA showcase — engraved timber plaques" onChange={function(e){setForm(function(f){return Object.assign({},f,{purpose:e.target.value});});}} style={Object.assign({},baseInput,{resize:"vertical",lineHeight:1.7})}/></div>
      </Card>

      <Card title="Job Type">
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {LASER_JOB_TYPES.map(function(jt){
            var sel = form.jobType === jt.id;
            return <div key={jt.id} className="rh" onClick={function(){setForm(function(f){return Object.assign({},f,{jobType:jt.id});});}} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", border:"2px solid "+(sel?"#a855f7":"#334155"), borderRadius:10, background:sel?"rgba(168,85,247,0.08)":"#162032", cursor:"pointer", transition:"all .15s" }}>
              <div style={{ fontSize:24, flexShrink:0 }}>{jt.emoji}</div>
              <div>
                <div style={{ fontSize:13, fontWeight:500, color:sel?"#d8b4fe":"#e2e8f0" }}>{jt.name}</div>
                <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>{jt.desc}</div>
              </div>
              {sel&&<div style={{ marginLeft:"auto", width:18, height:18, borderRadius:"50%", background:"#a855f7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", flexShrink:0 }}>✓</div>}
            </div>;
          })}
        </div>
      </Card>

      <Card title="Material">
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {LASER_MATERIALS.map(function(mat){
            var sel = form.laserMaterial === mat.id;
            var jt = form.jobType;
            var blocked = (jt==="Engrave"&&!mat.canEngrave) || (jt==="Cut"&&!mat.canCut) || (jt==="Vinyl Cut"&&!mat.bladeOk);
            return <div key={mat.id} className={blocked?"":"rh"} onClick={blocked?undefined:function(){setForm(function(f){return Object.assign({},f,{laserMaterial:mat.id,thickness:""});});}} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", border:"2px solid "+(sel?"#a855f7":"#334155"), borderRadius:10, background:sel?"rgba(168,85,247,0.08)":"#162032", cursor:blocked?"not-allowed":"pointer", opacity:blocked?0.35:1, transition:"all .15s" }}>
              <div style={{ fontSize:24, flexShrink:0 }}>{mat.emoji}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:500, color:sel?"#d8b4fe":"#e2e8f0" }}>{mat.name}</div>
                <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>{mat.desc}</div>
                {!blocked&&mat.canCut&&mat.maxMm40W>0&&<div style={{ fontSize:9, color:"#64748b", marginTop:3 }}>40W max cut: {mat.maxMm40W}mm</div>}
                {mat.canEngrave&&!mat.canCut&&<div style={{ fontSize:9, color:"#64748b", marginTop:3 }}>Engrave only — cutting not supported</div>}
              </div>
              {sel&&<div style={{ width:18, height:18, borderRadius:"50%", background:"#a855f7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", flexShrink:0 }}>✓</div>}
            </div>;
          })}
        </div>
      </Card>



      <Card title="Dimensions & Quantity">
        <div className="g2s">
          <div><Lbl>Material Thickness (mm)</Lbl><input type="number" min="0.1" step="0.1" value={form.thickness} placeholder="e.g. 3" onChange={function(e){setForm(function(f){return Object.assign({},f,{thickness:e.target.value});});}} style={baseInput}/><div style={{ fontSize:10, color:"#64748b", marginTop:4 }}>Leave blank if engraving only</div></div>
          <div>
            <Lbl>Quantity</Lbl>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button className="bh" onClick={function(){setForm(function(f){return Object.assign({},f,{quantity:Math.max(1,f.quantity-1)});});}} style={{ width:36, height:36, border:"1px solid #111827", borderRadius:6, background:"#162032", color:"#e2e8f0", fontSize:18, cursor:"pointer", fontFamily:"inherit" }}>-</button>
              <div style={{ flex:1, textAlign:"center", fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, color:"#a855f7" }}>{form.quantity}</div>
              <button className="bh" onClick={function(){setForm(function(f){return Object.assign({},f,{quantity:Math.min(50,f.quantity+1)});});}} style={{ width:36, height:36, border:"1px solid #111827", borderRadius:6, background:"#162032", color:"#e2e8f0", fontSize:18, cursor:"pointer", fontFamily:"inherit" }}>+</button>
            </div>
          </div>
          <div><Lbl>Design Width (mm, optional)</Lbl><input type="number" min="1" value={form.designWidth} placeholder="e.g. 150" onChange={function(e){setForm(function(f){return Object.assign({},f,{designWidth:e.target.value});});}} style={baseInput}/></div>
          <div><Lbl>Design Height (mm, optional)</Lbl><input type="number" min="1" value={form.designHeight} placeholder="e.g. 100" onChange={function(e){setForm(function(f){return Object.assign({},f,{designHeight:e.target.value});});}} style={baseInput}/></div>
        </div>
        {estTime&&<div style={{ background:"rgba(168,85,247,0.06)", border:"1px solid rgba(168,85,247,0.15)", borderRadius:8, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ fontSize:10, color:"#a855f7", letterSpacing:"0.08em", marginBottom:2 }}>ESTIMATED LASER TIME</div><div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:800, color:"#d8b4fe" }}>{estTime}</div></div>
          <div style={{ textAlign:"right" }}><div style={{ fontSize:10, color:"#64748b", marginBottom:2 }}>Power</div><div style={{ fontSize:12, color:"#a855f7" }}>{form.laserPower}</div></div>
        </div>}
        {warnings.length>0&&<div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {warnings.map(function(w,i){return <div key={i} style={{ background:w.type==="error"?"rgba(239,68,68,0.08)":"rgba(245,158,11,0.08)", border:"1px solid "+(w.type==="error"?"rgba(239,68,68,0.25)":"rgba(245,158,11,0.25)"), borderRadius:7, padding:"9px 12px", fontSize:11, color:w.type==="error"?"#ef4444":"#f59e0b", lineHeight:1.6 }}>{w.type==="error"?"❌":"⚠️"} {w.msg}</div>;})}
        </div>}
      </Card>

      <div><Lbl>Needed by</Lbl><input type="date" value={form.dueDate} min={new Date().toISOString().split("T")[0]} onChange={function(e){setForm(function(f){return Object.assign({},f,{dueDate:e.target.value});});}} style={Object.assign({},baseInput,{colorScheme:"dark"})}/></div>

      <Card title="Safety acknowledgement">
        <div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13, color:"#fca5a5", marginBottom:8 }}>🔐 H2D Laser Safety Requirements</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {["The H2D has laser-safe windows — do NOT remove protective covers during operation.",
              "Never leave the machine unattended during a laser job.",
              "Do not place flammable or explosive materials near the printer.",
              "The admin may adjust laser power or settings for safety before printing.",
              "Ventilation is required — laser operations produce fumes."
            ].map(function(s,i){return <div key={i} style={{ fontSize:11, color:"#9ca3af", display:"flex", gap:8 }}><span style={{ color:"#ef4444", flexShrink:0 }}>•</span>{s}</div>;})}
          </div>
        </div>
      </Card>

      <Card title="Any special instructions?">
        <textarea value={form.notes} rows={3} placeholder="e.g. font preferences, depth of engrave, specific positioning notes..." onChange={function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});}} style={Object.assign({},baseInput,{resize:"vertical",lineHeight:1.7})}/>
      </Card>

      <NavBtns onBack={function(){setStep(0);}} onNext={function(){setStep(2);}} disabled={!form.projectName||!form.dueDate||hasErrors} label="Review my request"/>
    </div>}

    {/* ── Step 2: Review ── */}
    {step===2&&<div className="fu" style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <Card title="Summary — does everything look right?">
        <div className="g2s" style={{ gap:10 }}>
          {[["Name",form.teacherName],["Email",form.email],["Department",form.department||"Not specified"],
            ["Project",form.projectName],["Job Type",form.jobType],["Material",selMat?selMat.name:"—"],
            ["Thickness",form.thickness?form.thickness+"mm":"N/A (engrave only)"],
            ["Laser",selJob&&selJob.needsLaser?"40W H2D":"N/A — "+form.jobType],
            ["Quantity","x"+form.quantity],["Due Date",form.dueDate?new Date(form.dueDate+"T00:00:00").toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long"}):"—"],
            ["Design File",laserFile?laserFile.name:"—"],["Source URL",form.sourceUrl||"Not provided"]
          ].map(function(pair){
            return <div key={pair[0]} style={{ background:"#162032", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:"#64748b", marginBottom:3 }}>{pair[0]}</div>
              <div style={{ fontSize:12, color:"#9ca3af", wordBreak:"break-all" }}>{pair[1]}</div>
            </div>;
          })}
        </div>
        {form.notes&&<div style={{ background:"#162032", borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:10, color:"#64748b", marginBottom:3 }}>Notes</div><div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.7 }}>{form.notes}</div></div>}
        {estTime&&<div style={{ background:"rgba(168,85,247,0.06)", border:"1px solid rgba(168,85,247,0.15)", borderRadius:8, padding:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ fontSize:10, color:"#a855f7", marginBottom:2 }}>Estimated laser time</div><div style={{ fontSize:20, fontFamily:"'Syne',sans-serif", fontWeight:900, color:"#d8b4fe" }}>{estTime}</div></div>
          <div style={{ textAlign:"right" }}><div style={{ fontSize:10, color:"#64748b", marginBottom:2 }}>File</div><div style={{ fontSize:11, color:"#94a3b8" }}>{laserFile&&laserFile.name}</div></div>
        </div>}
        <div style={{ background:"rgba(168,85,247,0.05)", border:"1px solid rgba(168,85,247,0.15)", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#a855f7" }}>
          🔴 This is a <strong>laser/cutting job</strong> on the Bambu Lab H2D. The admin will review your file before starting.
        </div>
      </Card>
      <div style={{ display:"flex", gap:10 }}>
        <button className="bh" onClick={function(){setStep(1);}} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:8, padding:"12px 20px", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>← Edit</button>
        <button className="bh" onClick={onSubmit} style={{ flex:1, background:"#7c3aed", color:"#fff", border:"none", borderRadius:8, padding:"14px 0", fontFamily:"inherit", fontSize:13, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer" }}>🔴 Submit Laser Request</button>
      </div>
    </div>}
  </div>;
}



// ─── Admin Login ──────────────────────────────────────────────────────────────
function AdminLogin({ onLogin }) {
  var se=useState(""); var email=se[0],setEmail=se[1];
  var sp=useState(""); var pw=sp[0],setPw=sp[1];
  var serr=useState(""); var err=serr[0],setErr=serr[1];
  var sloading=useState(false); var loading=sloading[0],setLoading=sloading[1];
  async function submit(e) {
    e.preventDefault(); setErr(""); setLoading(true);
    var admins = await loadAdmins();
    var match = admins.filter(function(a){return a.email.toLowerCase()===email.toLowerCase().trim();});
    if (!match.length) { setErr("No admin account found for that email."); setLoading(false); return; }
    var a = match[0];
    if (a.password !== pw) { setErr("Incorrect password."); setLoading(false); return; }
    onLogin(a);
  }
  return <div style={{ maxWidth:380, margin:"60px auto 0", background:"#1e293b", border:"1px solid #334155", borderRadius:14, overflow:"hidden" }}>
    <div style={{ borderBottom:"1px solid #334155", padding:"16px 20px" }}>
      <div style={{ fontSize:16, fontWeight:600 }}>Admin Login</div>
      <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>Print Lab staff only</div>
    </div>
    <form onSubmit={submit} style={{ padding:20, display:"flex", flexDirection:"column", gap:14 }}>
      <div><Lbl>Email</Lbl><input value={email} onChange={function(e){setEmail(e.target.value);}} type="email" placeholder="admin@macc.nsw.edu.au" style={baseInput} required/></div>
      <div><Lbl>Password</Lbl><input value={pw} onChange={function(e){setPw(e.target.value);}} type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" style={baseInput} required/></div>
      {err&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"9px 12px", fontSize:12, color:"#fca5a5" }}>{err}</div>}
      <button type="submit" disabled={loading} className="bh" style={{ background:"#ea580c", color:"#fff", border:"none", borderRadius:8, padding:"12px 0", fontFamily:"inherit", fontSize:13, cursor:loading?"not-allowed":"pointer", fontWeight:500 }}>{loading?"Signing in...":"Sign In"}</button>
    </form>
  </div>;
}

// ─── Change Password Modal ─────────────────────────────────────────────────────
function ChangePasswordModal({ admin, forced, onDone, onCancel }) {
  var sc=useState(""); var cur=sc[0],setCur=sc[1];
  var sn=useState(""); var nw=sn[0],setNw=sn[1];
  var scf=useState(""); var conf=scf[0],setConf=scf[1];
  var serr=useState(""); var err=serr[0],setErr=serr[1];
  async function save() {
    setErr("");
    if (!forced && cur !== admin.password) { setErr("Current password is incorrect."); return; }
    if (nw.length < 8) { setErr("New password must be at least 8 characters."); return; }
    if (nw !== conf) { setErr("Passwords do not match."); return; }
    var admins = await loadAdmins();
    var updated = admins.map(function(a){return a.email===admin.email?Object.assign({},a,{password:nw,mustReset:false}):a;});
    await saveAdmins(updated);
    onDone(Object.assign({},admin,{password:nw,mustReset:false}));
  }
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:420, background:"#1e293b", border:"1px solid #334155", borderRadius:14, overflow:"hidden" }}>
      <div style={{ borderBottom:"1px solid #334155", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:15, fontWeight:600 }}>{forced?"Set your password":"Change Password"}</div>
        {!forced&&<button onClick={onCancel} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18 }}>x</button>}
      </div>
      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:12 }}>
        {forced&&<div style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#fbbf24" }}>You must set a new password before continuing.</div>}
        {!forced&&<div><Lbl>Current Password</Lbl><input value={cur} onChange={function(e){setCur(e.target.value);}} type="password" style={baseInput}/></div>}
        <div><Lbl>New Password</Lbl><input value={nw} onChange={function(e){setNw(e.target.value);}} type="password" placeholder="Min. 8 characters" style={baseInput}/></div>
        <div><Lbl>Confirm New Password</Lbl><input value={conf} onChange={function(e){setConf(e.target.value);}} type="password" style={baseInput}/></div>
        {err&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"9px 12px", fontSize:12, color:"#fca5a5" }}>{err}</div>}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={save} className="bh" style={{ flex:1, background:"#ea580c", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"inherit", fontSize:13, cursor:"pointer", fontWeight:500 }}>Save Password</button>
          {!forced&&<button onClick={onCancel} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:8, padding:"11px 18px", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancel</button>}
        </div>
      </div>
    </div>
  </div>;
}

// ─── Manage Admins Modal ──────────────────────────────────────────────────────
function ManageAdmins({ currentAdmin, onClose }) {
  var sa=useState([]); var admins=sa[0],setAdmins=sa[1];
  var sform=useState(false); var showForm=sform[0],setShowForm=sform[1];
  var sfe=useState({name:"",email:"",role:"Admin",password:""}); var form=sfe[0],setForm=sfe[1];
  var serr=useState(""); var err=serr[0],setErr=serr[1];
  useEffect(function(){loadAdmins().then(setAdmins);},[]);
  async function add() {
    setErr("");
    if (!form.name||!form.email||!form.password) { setErr("All fields required."); return; }
    if (admins.filter(function(a){return a.email.toLowerCase()===form.email.toLowerCase();}).length) { setErr("That email already has an account."); return; }
    var updated = admins.concat([Object.assign({},form,{mustReset:true})]);
    await saveAdmins(updated); setAdmins(updated); setShowForm(false);
    setForm({name:"",email:"",role:"Admin",password:""});
  }
  async function remove(email) {
    if (email===currentAdmin.email) { setErr("You cannot remove your own account."); return; }
    var updated = admins.filter(function(a){return a.email!==email;});
    await saveAdmins(updated); setAdmins(updated);
  }
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:500, background:"#1e293b", border:"1px solid #334155", borderRadius:14, overflow:"hidden", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
      <div style={{ borderBottom:"1px solid #334155", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ fontSize:15, fontWeight:600 }}>Manage Admins</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18 }}>x</button>
      </div>
      <div style={{ padding:20, overflowY:"auto" }}>
        {err&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"9px 12px", fontSize:12, color:"#fca5a5", marginBottom:14 }}>{err}</div>}
        {admins.map(function(a){return <div key={a.email} style={{ background:"#162032", border:"1px solid #334155", borderRadius:8, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:13, color:"#f1f5f9", fontWeight:500 }}>{a.name}</div>
            <div style={{ fontSize:11, color:"#64748b" }}>{a.email} - {a.role}{a.mustReset?" - must reset password":""}</div>
          </div>
          {a.email!==currentAdmin.email&&<button onClick={function(){remove(a.email);}} className="bh" style={{ background:"rgba(239,68,68,0.08)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.2)", borderRadius:6, padding:"5px 10px", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>Remove</button>}
        </div>;})}
        {!showForm&&<button onClick={function(){setShowForm(true);}} className="bh" style={{ width:"100%", background:"transparent", color:"#64748b", border:"1px dashed #334155", borderRadius:8, padding:"10px 0", fontFamily:"inherit", fontSize:12, cursor:"pointer", marginTop:4 }}>+ Add Admin</button>}
        {showForm&&<div style={{ background:"#162032", border:"1px solid #334155", borderRadius:8, padding:14, marginTop:8, display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div><Lbl>Name</Lbl><input value={form.name} onChange={function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});}} style={baseInput}/></div>
            <div><Lbl>Email</Lbl><input value={form.email} onChange={function(e){setForm(function(f){return Object.assign({},f,{email:e.target.value});});}} style={baseInput}/></div>
            <div><Lbl>Role</Lbl>
              <select value={form.role} onChange={function(e){setForm(function(f){return Object.assign({},f,{role:e.target.value});});}} style={selectStyle}>
                <option>Admin</option><option>Head of STEM</option>
              </select>
            </div>
            <div><Lbl>Temp Password</Lbl><input value={form.password} onChange={function(e){setForm(function(f){return Object.assign({},f,{password:e.target.value});});}} type="text" style={baseInput}/></div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={add} className="bh" style={{ flex:1, background:"#ea580c", color:"#fff", border:"none", borderRadius:7, padding:"9px 0", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>Add Admin</button>
            <button onClick={function(){setShowForm(false);setErr("");}} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:7, padding:"9px 14px", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>}
      </div>
    </div>
  </div>;
}

// ─── Printer Settings Modal ───────────────────────────────────────────────────
function PrinterSettings({ onClose }) {
  var PSK = "pl_settings_v1";
  var sset=useState({printerName:"Bambu Lab H2D",bedX:310,bedY:250,bedZ:256,filamentCostPerKg:27.99,defaultMaterial:"PLA",operatingHours:"8:00-17:00",printingDays:"Mon-Fri"}); var settings=sset[0],setSettings=sset[1];
  useEffect(function(){sget(PSK).then(function(s){if(s)setSettings(function(prev){return Object.assign({},prev,s);});});},[]);
  async function save() { await sset(PSK, settings); onClose(); }
  function upd(k,v){setSettings(function(s){return Object.assign({},s,{[k]:v});});}
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:480, background:"#1e293b", border:"1px solid #334155", borderRadius:14, overflow:"hidden" }}>
      <div style={{ borderBottom:"1px solid #334155", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:15, fontWeight:600 }}>Printer Settings</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18 }}>x</button>
      </div>
      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div style={{ gridColumn:"1/-1" }}><Lbl>Printer Name</Lbl><input value={settings.printerName} onChange={function(e){upd("printerName",e.target.value);}} style={baseInput}/></div>
          <div><Lbl>Bed X (mm)</Lbl><input type="number" value={settings.bedX} onChange={function(e){upd("bedX",parseFloat(e.target.value));}} style={baseInput}/></div>
          <div><Lbl>Bed Y (mm)</Lbl><input type="number" value={settings.bedY} onChange={function(e){upd("bedY",parseFloat(e.target.value));}} style={baseInput}/></div>
          <div><Lbl>Bed Z (mm)</Lbl><input type="number" value={settings.bedZ} onChange={function(e){upd("bedZ",parseFloat(e.target.value));}} style={baseInput}/></div>
          <div><Lbl>Filament Cost (AUD/kg)</Lbl><input type="number" step="0.01" value={settings.filamentCostPerKg} onChange={function(e){upd("filamentCostPerKg",parseFloat(e.target.value));}} style={baseInput}/></div>
          <div><Lbl>Default Material</Lbl>
            <select value={settings.defaultMaterial} onChange={function(e){upd("defaultMaterial",e.target.value);}} style={selectStyle}>
              {["PLA","PETG","ABS","TPU"].map(function(m){return <option key={m}>{m}</option>;})}
            </select>
          </div>
          <div><Lbl>Operating Hours</Lbl><input value={settings.operatingHours} onChange={function(e){upd("operatingHours",e.target.value);}} placeholder="e.g. 8:00-17:00" style={baseInput}/></div>
          <div><Lbl>Printing Days</Lbl><input value={settings.printingDays} onChange={function(e){upd("printingDays",e.target.value);}} placeholder="e.g. Mon-Fri" style={baseInput}/></div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:4 }}>
          <button onClick={save} className="bh" style={{ flex:1, background:"#ea580c", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"inherit", fontSize:13, cursor:"pointer", fontWeight:500 }}>Save Settings</button>
          <button onClick={onClose} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:8, padding:"11px 18px", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  </div>;
}

// ─── Laser Consumables Inventory ─────────────────────────────────────────────
function LaserConsumablesModal({ laserInv, setLaserInv, onClose }) {
  async function updateQty(id, delta) {
    var updated = laserInv.map(function(c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, { qty: Math.max(0, (c.qty||0) + delta) });
    });
    setLaserInv(updated);
    await saveLaserInv(updated);
  }
  async function addCustom() {
    var name = prompt("Consumable name:");
    if (!name) return;
    var price = parseFloat(prompt("Price per unit (AUD):") || "0");
    var newC = { id:"c-"+Date.now(), name:name, unit:"unit", emoji:"📦", desc:"Custom consumable", price:price, qty:0, minQty:1, custom:true };
    var updated = laserInv.concat([newC]);
    setLaserInv(updated); await saveLaserInv(updated);
  }
  async function remove(id) {
    var updated = laserInv.filter(function(c) { return c.id !== id; });
    setLaserInv(updated); await saveLaserInv(updated);
  }
  var lowStock = laserInv.filter(function(c) { return (c.qty||0) < (c.minQty||1); });
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:560, background:"#1e293b", border:"1px solid #334155", borderRadius:14, overflow:"hidden", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
      <div style={{ borderBottom:"1px solid #334155", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ fontSize:15, fontWeight:600 }}>Laser Consumables</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18 }}>×</button>
      </div>
      <div style={{ padding:20, overflowY:"auto", display:"flex", flexDirection:"column", gap:10 }}>
        {lowStock.length > 0 && <div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#fca5a5" }}>
          ⚠ Low stock: {lowStock.map(function(c){return c.name;}).join(", ")}
        </div>}
        {laserInv.map(function(c) {
          var isLow = (c.qty||0) < (c.minQty||1);
          return <div key={c.id} style={{ background:"#162032", border:"1px solid "+(isLow?"rgba(239,68,68,0.25)":"#334155"), borderRadius:8, padding:"12px 14px", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:24, flexShrink:0 }}>{c.emoji}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, color:"#f1f5f9", fontWeight:500 }}>{c.name}</div>
              <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>{c.desc}</div>
              <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>Min: {c.minQty||1} {c.unit}(s) · {fmtAUD(c.price||0)}/{c.unit}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button onClick={function(){updateQty(c.id,-1);}} style={{ width:28, height:28, border:"1px solid #334155", borderRadius:6, background:"#1e293b", color:"#f1f5f9", cursor:"pointer", fontSize:16, fontFamily:"inherit" }}>-</button>
              <div style={{ textAlign:"center", minWidth:30 }}>
                <div style={{ fontSize:16, fontWeight:600, color:isLow?"#fca5a5":"#f1f5f9" }}>{c.qty||0}</div>
                <div style={{ fontSize:9, color:"#475569" }}>{c.unit}s</div>
              </div>
              <button onClick={function(){updateQty(c.id,1);}} style={{ width:28, height:28, border:"1px solid #334155", borderRadius:6, background:"#1e293b", color:"#f1f5f9", cursor:"pointer", fontSize:16, fontFamily:"inherit" }}>+</button>
              {c.custom&&<button onClick={function(){remove(c.id);}} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:14 }}>×</button>}
            </div>
          </div>;
        })}
        <button onClick={addCustom} style={{ background:"transparent", color:"#a78bfa", border:"1px dashed #334155", borderRadius:8, padding:"10px 0", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>+ Add consumable</button>
      </div>
    </div>
  </div>;
}



// ─── Print Utilisation Calendar ───────────────────────────────────────────────
function UtilisationCalendar({ requests }) {
  var snow=useState(new Date()); var viewDate=snow[0],setViewDate=snow[1];
  var y=viewDate.getFullYear(), m=viewDate.getMonth();
  var monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
  var daysInMonth=new Date(y,m+1,0).getDate();
  var firstDay=new Date(y,m,1).getDay(); // 0=Sun

  // Build daily stats
  var dayStats={};
  requests.forEach(function(r){
    var d=new Date(r.submittedAt);
    if(d.getFullYear()===y&&d.getMonth()===m){
      var key=d.getDate();
      if(!dayStats[key])dayStats[key]={jobs:0,laser:0,print:0,hrs:0,done:0};
      dayStats[key].jobs++;
      if(r.jobCategory==="laser")dayStats[key].laser++;
      else{dayStats[key].print++;dayStats[key].hrs+=r.stlStats?r.stlStats.estimatedHours*(r.quantity||1)*0.85:0;}
      if(r.status==="Done")dayStats[key].done++;
    }
  });

  var maxJobs=Math.max(1,Math.max.apply(null,Object.values(dayStats).map(function(d){return d.jobs;})));
  var today=new Date(); var isThisMonth=today.getFullYear()===y&&today.getMonth()===m;

  function prevMonth(){setViewDate(new Date(y,m-1,1));}
  function nextMonth(){setViewDate(new Date(y,m+1,1));}

  var dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return <div>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
      <div style={{ fontSize:14, fontWeight:600 }}>{monthNames[m]} {y}</div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={prevMonth} className="bh" style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:6, padding:"5px 12px", fontFamily:"inherit", fontSize:12, cursor:"pointer", color:"#94a3b8" }}>← Prev</button>
        <button onClick={nextMonth} className="bh" style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:6, padding:"5px 12px", fontFamily:"inherit", fontSize:12, cursor:"pointer", color:"#94a3b8" }}>Next →</button>
      </div>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:6 }}>
      {dayNames.map(function(d){return <div key={d} style={{ textAlign:"center", fontSize:9, color:"#475569", fontWeight:500, padding:"4px 0" }}>{d}</div>;})}
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
      {Array(firstDay).fill(null).map(function(_,i){return <div key={"e"+i}/>;  })}
      {Array(daysInMonth).fill(null).map(function(_,i){
        var day=i+1;
        var stats=dayStats[day]||{jobs:0,laser:0,print:0,hrs:0,done:0};
        var isToday=isThisMonth&&today.getDate()===day;
        var intensity=stats.jobs>0?Math.max(0.15,stats.jobs/maxJobs):0;
        var hasPrint=stats.print>0;
        var hasLaser=stats.laser>0;
        var bgColor=stats.jobs===0?"#162032":hasPrint&&hasLaser?"rgba(124,58,237,"+intensity+")":hasLaser?"rgba(124,58,237,"+intensity+")":"rgba(249,115,22,"+intensity+")";
        return <div key={day} title={stats.jobs>0?stats.jobs+" job(s), "+stats.done+" done, "+stats.hrs.toFixed(1)+"h print":""} style={{ aspectRatio:"1", background:bgColor, border:"1px solid "+(isToday?"#3b82f6":"#334155"), borderRadius:6, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, position:"relative" }}>
          <div style={{ fontSize:10, color:stats.jobs>0?"#f1f5f9":"#475569", fontWeight:isToday?700:400 }}>{day}</div>
          {stats.jobs>0&&<div style={{ fontSize:8, color:"rgba(255,255,255,0.7)" }}>{stats.jobs} job{stats.jobs!==1?"s":""}</div>}
          {isToday&&<div style={{ position:"absolute", bottom:2, left:"50%", transform:"translateX(-50%)", width:4, height:4, borderRadius:"50%", background:"#3b82f6" }}/>}
        </div>;
      })}
    </div>
    <div style={{ display:"flex", gap:16, marginTop:10, fontSize:10, color:"#64748b" }}>
      <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, background:"rgba(249,115,22,0.5)", borderRadius:2 }}/> 3D Print</div>
      <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, background:"rgba(124,58,237,0.5)", borderRadius:2 }}/> Laser/Both</div>
      <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, background:"#162032", border:"1px solid #334155", borderRadius:2 }}/> No jobs</div>
    </div>
  </div>;
}
// ─── Supabase / Shared Queue Settings Modal ───────────────────────────────────
function SupabaseSettingsModal({ sbUrl, setSbUrl, sbKey, setSbKey, sbConnected, setSbConnected, onClose }) {
  var stest=useState("idle"); var testState=stest[0],setTestState=stest[1];
  async function save() {
    setTestState("testing");
    try {
      localStorage.setItem("pl_sb_url", sbUrl);
      localStorage.setItem("pl_sb_key", sbKey);
      var ok = initSupabase(sbUrl, sbKey);
      if (ok) {
        // Verify connection with a simple query
        await _sb.from("printlab_store").select("key").limit(1);
        setSbConnected(true); setTestState("ok");
      } else { setTestState("fail"); setSbConnected(false); }
    } catch(e) { setTestState("fail"); setSbConnected(false); }
  }
  function clear() {
    try { localStorage.removeItem("pl_sb_url"); localStorage.removeItem("pl_sb_key"); } catch(e) {}
    setSbUrl(""); setSbKey(""); _sb = null; setSbConnected(false); setTestState("idle"); onClose();
  }
  return <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
    <div style={{ width:"100%", maxWidth:520, background:"#1e293b", border:"1px solid #334155", borderRadius:14, overflow:"hidden" }}>
      <div style={{ borderBottom:"1px solid #334155", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:15, fontWeight:600 }}>Shared Queue — Supabase</div>
          <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>Connect to a Supabase database so all admins share the same queue in real time</div>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18 }}>×</button>
      </div>
      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:14 }}>
        <div style={{ background:"rgba(37,99,235,0.07)", border:"1px solid rgba(37,99,235,0.2)", borderRadius:8, padding:"12px 14px", fontSize:11, color:"#94a3b8", lineHeight:1.8 }}>
          <strong style={{ color:"#60a5fa" }}>Setup:</strong> Create a free Supabase project → create a table called <code style={{ background:"#162032", padding:"1px 5px", borderRadius:3 }}>printlab_store</code> with columns <code style={{ background:"#162032", padding:"1px 5px", borderRadius:3 }}>key text PK, value text, updated_at timestamptz</code> → paste your Project URL and anon key below.
        </div>
        <div>
          <Lbl>Supabase Project URL</Lbl>
          <input value={sbUrl} onChange={function(e){setSbUrl(e.target.value);setTestState("idle");}} placeholder="https://xxxxxxxxxxxx.supabase.co" style={baseInput}/>
        </div>
        <div>
          <Lbl>Anon / Public Key</Lbl>
          <input value={sbKey} onChange={function(e){setSbKey(e.target.value);setTestState("idle");}} placeholder="eyJhbGciOiJIUzI1NiIs..." style={Object.assign({},baseInput,{fontFamily:"'DM Mono',monospace",fontSize:11})}/>
        </div>
        {testState==="ok"&&<div style={{ background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.25)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#4ade80" }}>✓ Connected! Queue is now shared across all admin devices.</div>}
        {testState==="fail"&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#fca5a5" }}>✗ Connection failed. Check your URL and key, and ensure the printlab_store table exists.</div>}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={save} className="bh" style={{ flex:1, background:testState==="testing"?"#334155":"#2563eb", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"inherit", fontSize:13, cursor:"pointer", fontWeight:500 }}>{testState==="testing"?"Testing...":"Save & Connect"}</button>
          {sbConnected&&<button onClick={clear} style={{ flex:"0 0 auto", background:"rgba(239,68,68,0.08)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.25)", borderRadius:8, padding:"11px 18px", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Disconnect</button>}
        </div>
        <div style={{ fontSize:11, color:"#475569", lineHeight:1.7, paddingTop:8, borderTop:"1px solid #334155" }}>
          Once connected, the queue will also be accessible when you host on your school server. File storage for STLs will migrate to Supabase Storage automatically when you add <code style={{ background:"#162032", padding:"1px 5px", borderRadius:3 }}>STORAGE_BUCKET</code> to your config.
        </div>
      </div>
    </div>
  </div>;
}

// ─── Laser Inventory Page ─────────────────────────────────────────────────────
function LaserInventoryPage({ laserInv, setLaserInv }) {
  var srestk=useState(null); var restockId=srestk[0],setRestockId=srestk[1];
  var srestq=useState(1); var restockQty=srestq[0],setRestockQty=srestq[1];
  var sform=useState(false); var showForm=sform[0],setShowForm=sform[1];
  var sfe=useState({name:"",emoji:"📦",desc:"",unit:"sheet",price:"",minQty:"2"}); var form=sfe[0],setForm=sfe[1];
  var sforme=useState(""); var formErr=sforme[0],setFormErr=sforme[1];
  var seid=useState(null); var editId=seid[0],setEditId=seid[1];

  async function save(updated) { setLaserInv(updated); await saveLaserInv(updated); }

  async function restock(id) {
    await save(laserInv.map(function(c){return c.id===id?Object.assign({},c,{qty:(c.qty||0)+restockQty}):c;}));
    setRestockId(null);
  }

  async function use1(id) {
    await save(laserInv.map(function(c){return c.id===id?Object.assign({},c,{qty:Math.max(0,(c.qty||0)-1)}):c;}));
  }

  function openAdd() { setForm({name:"",emoji:"📦",desc:"",unit:"sheet",price:"",minQty:"2"}); setEditId(null); setFormErr(""); setShowForm(true); }
  function openEdit(c) { setForm({name:c.name,emoji:c.emoji||"📦",desc:c.desc||"",unit:c.unit||"sheet",price:""+c.price,minQty:""+(c.minQty||1)}); setEditId(c.id); setFormErr(""); setShowForm(true); }
  function cancelForm() { setShowForm(false); setEditId(null); setFormErr(""); }

  async function submitForm() {
    setFormErr("");
    if(!form.name.trim()){setFormErr("Enter a name.");return;}
    var price=parseFloat(form.price);
    if(isNaN(price)||price<0){setFormErr("Enter a valid price.");return;}
    var minQ=parseInt(form.minQty)||1;
    if(editId){
      await save(laserInv.map(function(c){return c.id!==editId?c:Object.assign({},c,{name:form.name.trim(),emoji:form.emoji,desc:form.desc.trim(),unit:form.unit,price:price,minQty:minQ,custom:true});}));
    } else {
      var newC={id:"lc-"+Date.now(),name:form.name.trim(),emoji:form.emoji,desc:form.desc.trim(),unit:form.unit,price:price,minQty:minQ,qty:0,custom:true};
      await save(laserInv.concat([newC]));
    }
    cancelForm();
  }

  async function remove(id) { await save(laserInv.filter(function(c){return c.id!==id;})); }

  var lowStock = laserInv.filter(function(c){return (c.qty||0)<(c.minQty||1);});
  var totalValue = laserInv.reduce(function(a,c){return a+(c.qty||0)*(c.price||0);},0);

  var UNITS = ["sheet","mat","roll","piece","unit","pack"];
  var EMOJIS = ["📦","🪵","🎨","⬛","🟤","⬜","🟩","🟦","🔲","📋","✂️","🖊️"];

  return <div>
    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20 }}>
      <div>
        <div style={{ fontSize:22, fontWeight:600, marginBottom:4 }}>Laser Consumables</div>
        <div style={{ fontSize:12, color:"#64748b" }}>
          {laserInv.length} item types — {lowStock.length} low stock — Est. value: <span style={{ color:"#22c55e" }}>{fmtAUD(totalValue)}</span>
        </div>
      </div>
      <button onClick={openAdd} className="bh" style={{ background:"#7c3aed", color:"#fff", border:"none", borderRadius:8, padding:"10px 18px", fontFamily:"inherit", fontSize:13, cursor:"pointer", fontWeight:500 }}>+ Add Consumable</button>
    </div>

    {lowStock.length>0&&<div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:10, padding:16, marginBottom:20 }}>
      <div style={{ fontSize:13, fontWeight:600, color:"#fca5a5", marginBottom:10 }}>⚠ Low Stock — Needs Restocking</div>
      {lowStock.map(function(c){return <div key={c.id} style={{ display:"flex", alignItems:"center", gap:12, background:"rgba(239,68,68,0.05)", borderRadius:8, padding:"9px 12px", marginBottom:6 }}>
        <div style={{ fontSize:20 }}>{c.emoji}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, color:"#f1f5f9" }}>{c.name}</div>
          <div style={{ fontSize:10, color:"#ef4444" }}>{c.qty||0} {c.unit}(s) remaining — min {c.minQty||1}</div>
        </div>
      </div>;})}
    </div>}

    {showForm&&<div style={{ background:"#1e293b", border:"1px solid rgba(124,58,237,0.3)", borderRadius:12, padding:20, marginBottom:20 }}>
      <div style={{ fontSize:14, fontWeight:600, color:"#a78bfa", marginBottom:16 }}>{editId?"Edit Consumable":"Add Consumable"}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        <div>
          <Lbl>Name</Lbl>
          <input value={form.name} onChange={function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});}} placeholder="e.g. 3mm Basswood Sheet" style={baseInput}/>
        </div>
        <div>
          <Lbl>Description</Lbl>
          <input value={form.desc} onChange={function(e){setForm(function(f){return Object.assign({},f,{desc:e.target.value});});}} placeholder="e.g. A4 size, cuts cleanly" style={baseInput}/>
        </div>
        <div>
          <Lbl>Emoji Icon</Lbl>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {EMOJIS.map(function(em){return <button key={em} onClick={function(){setForm(function(f){return Object.assign({},f,{emoji:em});});}} style={{ width:34, height:34, fontSize:18, background:form.emoji===em?"rgba(124,58,237,0.2)":"#162032", border:"1px solid "+(form.emoji===em?"#7c3aed":"#334155"), borderRadius:6, cursor:"pointer" }}>{em}</button>;})}
          </div>
        </div>
        <div>
          <Lbl>Unit</Lbl>
          <select value={form.unit} onChange={function(e){setForm(function(f){return Object.assign({},f,{unit:e.target.value});});}} style={selectStyle}>
            {UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}
          </select>
        </div>
        <div>
          <Lbl>Price per unit (AUD)</Lbl>
          <input type="number" min="0" step="0.01" value={form.price} onChange={function(e){setForm(function(f){return Object.assign({},f,{price:e.target.value});});}} placeholder="e.g. 4.50" style={baseInput}/>
        </div>
        <div>
          <Lbl>Minimum stock level</Lbl>
          <input type="number" min="1" value={form.minQty} onChange={function(e){setForm(function(f){return Object.assign({},f,{minQty:e.target.value});});}} placeholder="e.g. 2" style={baseInput}/>
          <div style={{ fontSize:10, color:"#64748b", marginTop:4 }}>Triggers low stock warning below this number</div>
        </div>
      </div>
      {formErr&&<div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"9px 12px", fontSize:12, color:"#ef4444", marginBottom:12 }}>{formErr}</div>}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={submitForm} className="bh" style={{ flex:1, background:"#7c3aed", color:"#fff", border:"none", borderRadius:8, padding:"11px 0", fontFamily:"inherit", fontSize:13, cursor:"pointer", fontWeight:500 }}>{editId?"Save Changes":"Add to Inventory"}</button>
        <button onClick={cancelForm} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:8, padding:"11px 20px", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>}

    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {laserInv.map(function(c) {
        var isLow = (c.qty||0)<(c.minQty||1);
        var pct = c.minQty ? Math.min(100,(c.qty||0)/(c.minQty*3)*100) : Math.min(100,(c.qty||0)/5*100);
        return <div key={c.id} style={{ background:"#1e293b", border:"1px solid "+(isLow?"rgba(239,68,68,0.25)":"#334155"), borderRadius:10, padding:"14px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:44, height:44, borderRadius:10, background:"rgba(124,58,237,0.12)", border:"1px solid rgba(124,58,237,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{c.emoji}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                <div style={{ fontSize:14, fontWeight:500, color:"#f1f5f9" }}>{c.name}</div>
                {c.custom&&<span style={{ fontSize:9, background:"rgba(124,58,237,0.15)", color:"#a78bfa", borderRadius:3, padding:"2px 6px" }}>CUSTOM</span>}
                {isLow&&<span style={{ fontSize:9, background:"rgba(239,68,68,0.15)", color:"#fca5a5", borderRadius:3, padding:"2px 6px" }}>LOW STOCK</span>}
              </div>
              <div style={{ fontSize:11, color:"#64748b" }}>{c.desc}</div>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:8 }}>
                <div style={{ flex:1, height:4, background:"#334155", borderRadius:2 }}>
                  <div style={{ width:pct+"%", height:"100%", background:isLow?"#ef4444":"#7c3aed", borderRadius:2, transition:"width .3s" }}/>
                </div>
                <div style={{ fontSize:11, color:isLow?"#fca5a5":"#94a3b8", whiteSpace:"nowrap" }}>{c.qty||0} {c.unit}(s) · {fmtAUD(c.price||0)}/unit</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
              {restockId===c.id?<div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <input type="number" min={1} max={99} value={restockQty} onChange={function(e){setRestockQty(parseInt(e.target.value)||1);}} style={{ width:50, background:"#162032", border:"1px solid #334155", borderRadius:6, padding:"5px 8px", color:"#f1f5f9", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none" }}/>
                <button onClick={function(){restock(c.id);}} style={{ background:"#22c55e", color:"#fff", border:"none", borderRadius:6, padding:"5px 10px", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>Add</button>
                <button onClick={function(){setRestockId(null);}} style={{ background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:6, padding:"5px 8px", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>✕</button>
              </div>:<>
                <button onClick={function(){use1(c.id);}} disabled={(c.qty||0)===0} className="bh" style={{ background:"rgba(239,68,68,0.08)", color:(c.qty||0)===0?"#334155":"#fca5a5", border:"1px solid "+(c.qty||0)===0?"#334155":"rgba(239,68,68,0.25)", borderRadius:6, padding:"6px 12px", fontFamily:"inherit", fontSize:12, cursor:(c.qty||0)===0?"not-allowed":"pointer" }}>Use 1</button>
                <button onClick={function(){setRestockId(c.id);setRestockQty(1);}} className="bh" style={{ background:"rgba(34,197,94,0.08)", color:"#4ade80", border:"1px solid rgba(34,197,94,0.25)", borderRadius:6, padding:"6px 12px", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>+ Restock</button>
                <button onClick={function(){openEdit(c);}} className="bh" style={{ background:"rgba(59,130,246,0.08)", color:"#60a5fa", border:"1px solid rgba(59,130,246,0.25)", borderRadius:6, padding:"6px 12px", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>Edit</button>
                {c.custom&&<button onClick={function(){remove(c.id);}} className="bh" style={{ background:"rgba(239,68,68,0.06)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.2)", borderRadius:6, padding:"6px 12px", fontFamily:"inherit", fontSize:12, cursor:"pointer" }}>Remove</button>}
              </>}
            </div>
          </div>
        </div>;
      })}
    </div>
  </div>;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function PrintPortal() {
  var sw=useWidth();
  var isMobile=sw<768;

  var sv=useState("submit"); var view=sv[0],setView=sv[1];
  var sjm=useState(null); var jobMode=sjm[0],setJobMode=sjm[1];
  var sreqs=useState([]); var requests=sreqs[0],setRequests=sreqs[1];
  var sload=useState(true); var loading=sload[0],setLoading=sload[1];
  var sinv=useState([]); var inv=sinv[0],setInv=sinv[1];
  var slform=useState({teacherName:"",email:"",department:"",projectName:"",purpose:"",
    jobType:"Engrave",laserMaterial:"wood",thickness:"",laserPower:"40W",
    designWidth:"",designHeight:"",quantity:1,dueDate:"",notes:"",sourceUrl:""});
  var lform=slform[0],setLform=slform[1];
  var slfile=useState(null); var laserFile=slfile[0],setLaserFile=slfile[1];
  var slstep=useState(0); var laserStep=slstep[0],setLaserStep=slstep[1];
  var slsub=useState(false); var laserSubmitted=slsub[0],setLaserSubmitted=slsub[1];
  var slconf=useState(false); var laserConfetti=slconf[0],setLaserConfetti=slconf[1];
  var lfileRef=useRef(null);
  var sadmin=useState(null); var admin=sadmin[0],setAdmin=sadmin[1];
  var scpw=useState(false); var showCPw=scpw[0],setShowCPw=scpw[1];
  var sma=useState(false); var showMA=sma[0],setShowMA=sma[1];
  var sps=useState(false); var showPrinterSettings=sps[0],setShowPrinterSettings=sps[1];
  var stpl=useState(false); var showTemplates=stpl[0],setShowTemplates=stpl[1];
  var sstep=useState(0); var step=sstep[0],setStep=sstep[1];
  var sform=useState({teacherName:"",email:"",department:"",projectName:"",purpose:"",quantity:1,dueDate:"",material:"PLA",color:"",filamentId:"",notes:"",sourceUrl:"",priority:false});
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
  var sfiledata=useState(null); var stlFileData=sfiledata[0],setStlFileData=sfiledata[1];
  var s3mf=useState(null); var stl3MFMeta=s3mf[0],setStl3MFMeta=s3mf[1];
  var ssearch=useState(""); var searchQuery=ssearch[0],setSearchQuery=ssearch[1];
  var ssel=useState({}); var selected=ssel[0],setSelected=ssel[1];
  var selCount=Object.keys(selected).filter(function(k){return selected[k];}).length;
  var srej=useState(false); var showReject=srej[0],setShowReject=srej[1];
  var srejnote=useState(""); var rejectNote=srejnote[0],setRejectNote=srejnote[1];
  var sfailnote=useState(""); var failNote=sfailnote[0],setFailNote=sfailnote[1];
  var sshowfail=useState(false); var showFail=sshowfail[0],setShowFail=sshowfail[1];
  var slasinv=useState([]); var laserInv=slasinv[0],setLaserInv=slasinv[1];
  var slinvview=useState(false); var showLaserInv=slinvview[0],setShowLaserInv=slinvview[1];
  var ssbset=useState(false); var showSBSettings=ssbset[0],setShowSBSettings=ssbset[1];
  var ssburl=useState(function(){try{return localStorage.getItem("pl_sb_url")||"";}catch(e){return "";}}); var sbUrl=ssburl[0],setSbUrl=ssburl[1];
  var ssbkey=useState(function(){try{return localStorage.getItem("pl_sb_key")||"";}catch(e){return "";}}); var sbKey=ssbkey[0],setSbKey=ssbkey[1];
  var ssbconn=useState(false); var sbConnected=ssbconn[0],setSbConnected=ssbconn[1];
  var snotif=useState(function(){try{return typeof Notification!=="undefined"&&Notification.permission==="granted";}catch(e){return false;}}); var notifEnabled=snotif[0],setNotifEnabled=snotif[1];
  var stemail=useState(""); var trackEmail=stemail[0],setTrackEmail=stemail[1];
  var slasfile=useState(null); var laserFileData=slasfile[0],setLaserFileData=slasfile[1];
  var ssvgdims=useState(null); var svgDims=ssvgdims[0],setSvgDims=ssvgdims[1];

  useEffect(function(){
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/macc-printlab/sw.js").catch(function() {});
    }
  },[]);

  // Init Supabase if previously configured
  useEffect(function(){
    var url = sbUrl; var key = sbKey;
    if (url && key) { var ok = initSupabase(url, key); setSbConnected(ok); }
  }, []);

  // Poll every 30s: refetch requests + check notification-worthy status changes
  useEffect(function(){
    var id = setInterval(function(){
      loadReqs().then(function(r){setRequests(r);});
      if (trackEmail) checkStatusChanges(requests, trackEmail);
    }, 30000);
    return function(){ clearInterval(id); };
  }, [trackEmail]); // intentionally omit requests to avoid infinite re-poll loop

  useEffect(function(){
    loadReqs().then(function(r){setRequests(r);setLoading(false);});
    loadInv().then(setInv);
    loadLaserInv().then(setLaserInv);
  },[]);

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
    var nameL=file.name.toLowerCase();
    var isSTL=nameL.endsWith(".stl");
    var is3mf=nameL.endsWith(".3mf");
    if(!isSTL&&!is3mf){setStlError("Please upload a .stl or .3mf file.");setStlFile(null);setStlStats(null);return;}
    setStlError("");setStlFile(file);setStlStats(null);setParsing(true);
    var guessed=cleanName(file.name.replace(/\.(stl|3mf)$/i,""));
    setForm(function(f){return Object.assign({},f,{projectName:f.projectName?f.projectName:guessed});});
    // Store file as base64 if small enough (done immediately, before async parsing)
    if(file.size<=MAX_STORE_BYTES){
      fileToBase64(file).then(function(b64){setStlFileData(b64);});
    } else {
      setStlFileData(null);
    }
    try{
      var buf=await file.arrayBuffer();
      if(is3mf){
        if(!is3MF(buf)){setStlError("This .3mf file appears to be invalid or corrupted.");setStlStats(null);setParsing(false);return;}
        var meta=extract3MFMeta(buf);
        setStl3MFMeta(meta);
        setStlStats(null);
        setParsing(false);
        return;
      }
      var stats=parseSTL(buf);if(!stats)throw new Error("Cannot parse this STL.");setStlStats(stats);
    }catch(e){setStlError("Could not read file: "+e.message);setStlStats(null);}
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
    var req=Object.assign({},form,{id:Date.now()+"",fileName:stlFile.name,fileSize:stlFile.size,stlStats:statsClean,fileData:stlFileData,submittedAt:new Date().toISOString(),status:"Pending",log:[],estimatedReadyDate:readyDate.toISOString(),is3mf:!!stl3MFMeta,meta3mf:stl3MFMeta});
    var updated=[req].concat(requests);setRequests(updated);await saveReqs(updated);
    setSubmittedReadyDate(readyDate);
    setShowConfetti(true);setSubmitted(true);
    // Send receipt email to teacher
    (function(){
      var jobId = req.id;
      var readyStr = readyDate.toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long"});
      var parts = ["Hi "+req.teacherName+",","","Your 3D print request has been received! Here are your details:","","Job ID: "+jobId,"Project: "+req.projectName,"Material: "+req.material+" ("+req.color+")","Quantity: x"+req.quantity,"File: "+req.fileName,"Estimated Ready: "+readyStr,"","Track your job status at: "+window.location.href,"","Thanks,","MACC Print Lab"];
      var body = parts.join("\n");
      setTimeout(function(){window.open("mailto:"+req.email+"?subject="+encodeURIComponent("Print Request Received — "+req.projectName)+"&body="+encodeURIComponent(body));},800);
    })();
    setTimeout(function(){setShowConfetti(false);},3000);
    setTimeout(function(){setSubmitted(false);setStep(0);setForm({teacherName:"",email:"",department:"",projectName:"",purpose:"",quantity:1,dueDate:"",material:"PLA",color:"",filamentId:"",notes:"",sourceUrl:"",priority:false});setStlFile(null);setStlStats(null);setStlFileData(null);setStl3MFMeta(null);setUrlInfo("");setSubmittedReadyDate(null);},3500);
  }

  async function handleLaserSubmit() {
    var req = Object.assign({}, lform, {
      id: "L-" + Date.now(),
      jobCategory: "laser",
      fileName: laserFile ? laserFile.name : "",
      fileSize: laserFile ? laserFile.size : 0,
      fileData: laserFileData,
      svgDimsMM: svgDims,
      submittedAt: new Date().toISOString(),
      status: "Pending",
      log: []
    });
    var updated = [req].concat(requests);
    setRequests(updated); await saveReqs(updated);
    setLaserConfetti(true); setLaserSubmitted(true);
    (function(){
      var parts = ["Hi "+req.teacherName+",","","Your laser job request has been received!","","Job ID: "+req.id,"Project: "+req.projectName,"Job Type: "+(req.jobType||"Engrave"),"Material: "+(req.laserMaterial||""),"File: "+(req.fileName||""),"","Track your status at: "+window.location.href,"","Thanks,","MACC Print Lab"];
      var body = parts.join("\n");
      setTimeout(function(){window.open("mailto:"+req.email+"?subject="+encodeURIComponent("Laser Request Received — "+req.projectName)+"&body="+encodeURIComponent(body));},800);
    })();
    setTimeout(function() { setLaserConfetti(false); }, 3000);
    setTimeout(function() {
      setLaserSubmitted(false); setLaserStep(0);
      setLform({teacherName:"",email:"",department:"",projectName:"",purpose:"",
        jobType:"Engrave",laserMaterial:"wood",thickness:"",laserPower:"40W",
        designWidth:"",designHeight:"",quantity:1,dueDate:"",notes:"",sourceUrl:""});
      setLaserFile(null);
      setLaserFileData(null);
      setSvgDims(null);
    }, 3500);
  }

  async function approveReq(id) {
    var updated=requests.map(function(r){if(r.id!==id)return r;return Object.assign({},r,{status:"Queued",log:addLog(r,"Approved by "+admin.name)});});
    setRequests(updated);await saveReqs(updated);syncSel(updated);
  }

  async function rejectReq(id, reason) {
    var updated=requests.map(function(r){if(r.id!==id)return r;return Object.assign({},r,{status:"Cancelled",rejectionReason:reason,log:addLog(r,"Rejected: "+reason)});});
    setRequests(updated);await saveReqs(updated);syncSel(updated);
    var req=requests.filter(function(r){return r.id===id;})[0];
    if(req) sendRejectEmail(req, admin, reason);
    setShowReject(false);setRejectNote("");
  }

  async function markFailed(req, reason) {
    var updated=requests.map(function(r){if(r.id!==req.id)return r;return Object.assign({},r,{status:"Failed",failureReason:reason,log:addLog(r,"Failed: "+reason)});});
    setRequests(updated);await saveReqs(updated);syncSel(updated);
    sendFailedEmail(req, admin, reason);
    setShowFail(false);setFailNote("");
  }

  async function requeueFailed(id) {
    var updated=requests.map(function(r){if(r.id!==id)return r;return Object.assign({},r,{status:"Queued",printStartedAt:null,log:addLog(r,"Re-queued after failure")});});
    setRequests(updated);await saveReqs(updated);syncSel(updated);
  }

  async function batchApprove() {
    var ids=Object.keys(selected).filter(function(k){return selected[k];});
    var updated=requests.map(function(r){if(ids.indexOf(r.id)<0||r.status!=="Pending")return r;return Object.assign({},r,{status:"Queued",log:addLog(r,"Approved (batch) by "+admin.name)});});
    setRequests(updated);await saveReqs(updated);setSelected({});
  }
  async function batchCancel() {
    var ids=Object.keys(selected).filter(function(k){return selected[k];});
    var updated=requests.map(function(r){if(ids.indexOf(r.id)<0)return r;return Object.assign({},r,{status:"Cancelled",log:addLog(r,"Cancelled (batch) by "+admin.name)});});
    setRequests(updated);await saveReqs(updated);setSelected({});syncSel(updated);
  }
  async function batchDelete() {
    var ids=Object.keys(selected).filter(function(k){return selected[k];});
    var updated=requests.filter(function(r){return ids.indexOf(r.id)<0;});
    setRequests(updated);await saveReqs(updated);setSelected({});if(selReq&&ids.indexOf(selReq.id)>=0)setSelReq(null);
  }
  function toggleSelect(id,e) { e.stopPropagation(); setSelected(function(s){var n=Object.assign({},s);n[id]=!n[id];return n;}); }
  function selectAll() {
    var allIds={};filtered.forEach(function(r){allIds[r.id]=true;});
    setSelected(Object.keys(allIds).length===selCount?{}:allIds);
  }

  function reprintJob(req) {
    setForm(function(f) {
      return Object.assign({}, f, {
        projectName: req.projectName, purpose: req.purpose||"",
        quantity: req.quantity, material: req.material, color: req.color,
        department: req.department||"", notes: req.notes||"", sourceUrl: req.sourceUrl||"",
        dueDate: "", priority: false, filamentId: req.filamentId||""
      });
    });
    setJobMode("print"); setStep(0); setView("submit");
  }

  function addLog(req,msg){return(req.log||[]).concat([{msg:msg,by:admin?admin.name:"",at:new Date().toISOString()}]);}
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
  var filtered=(function(){
    var base=filterStatus==="All"?requests:requests.filter(function(r){return r.status===filterStatus;});
    if(!searchQuery.trim())return base;
    var q=searchQuery.toLowerCase();
    return base.filter(function(r){
      return (r.projectName||"").toLowerCase().indexOf(q)>=0
        ||(r.teacherName||"").toLowerCase().indexOf(q)>=0
        ||(r.department||"").toLowerCase().indexOf(q)>=0
        ||(r.fileName||"").toLowerCase().indexOf(q)>=0
        ||(r.material||"").toLowerCase().indexOf(q)>=0
        ||(r.status||"").toLowerCase().indexOf(q)>=0;
    });
  })();
  var qs={pend:requests.filter(function(r){return r.status==="Pending";}).length,q:requests.filter(function(r){return r.status==="Queued";}).length,p:requests.filter(function(r){return r.status==="Printing";}).length,d:requests.filter(function(r){return r.status==="Done";}).length,f:requests.filter(function(r){return r.status==="Failed";}).length};
  var isAdminView=view==="log"||view==="inventory"||view==="laser-inv"||view==="insights"||view==="report";

  var TABS=[["submit","New Request",false],["status","My Status",false],["stats","Stats",false],["log","Queue ("+requests.length+")"+(qs.pend>0?" · "+qs.pend+" pending":""),true],["inventory","3D Filament",true],["laser-inv","Laser Stock",true],["insights","Insights",true],["report","Report",true]];

  return <div style={{ minHeight:"100vh", background:"#0f172a", fontFamily:"'Inter','Segoe UI','system-ui',-apple-system,sans-serif", color:"#f1f5f9" }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
      /* Font fallbacks if Google Fonts unavailable */
      :root { --font-body: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; --font-mono: 'DM Mono', 'Menlo', 'Courier New', monospace; }
      *{box-sizing:border-box;margin:0;padding:0}
      html{-webkit-text-size-adjust:100%}
      body{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
      ::-webkit-scrollbar{width:5px}
      ::-webkit-scrollbar-track{background:#1e293b}
      ::-webkit-scrollbar-thumb{background:#475569;border-radius:3px}
      ::-webkit-scrollbar-thumb:hover{background:#64748b}
      input,select,textarea{font-family:inherit}
      input:focus,select:focus,textarea:focus{border-color:#3b82f6!important;box-shadow:0 0 0 3px rgba(59,130,246,0.15)!important;outline:none}
      select option{background:#1e293b;color:#f1f5f9}
      .drag-over{border-color:#3b82f6!important;background:rgba(59,130,246,0.06)!important}
      @keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes cf{to{transform:translateY(110vh) rotate(720deg);opacity:0}}
      @keyframes ci{0%{transform:scale(0.8);opacity:0}100%{transform:scale(1);opacity:1}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
      .fu{animation:fu .25s ease forwards}
      .ci{animation:ci .3s ease forwards}
      .pulse{animation:pulse 1.5s infinite}
      .bh{transition:opacity .12s,background .12s,border-color .12s;cursor:pointer;-webkit-tap-highlight-color:rgba(0,0,0,0)}
      .bh:hover{opacity:.88}
      .rh{transition:background .1s;cursor:pointer}
      .rh:hover{background:rgba(255,255,255,0.03)!important}
      .mc{transition:transform .18s,border-color .18s,background .18s;cursor:pointer}
      .mc:hover{transform:translateY(-2px)}
      .cs{transition:transform .12s,box-shadow .12s;cursor:pointer}
      .cs:hover{transform:scale(1.08)}
      .g4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
      .g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .g2s{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
      .gc2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
      .det{display:grid;grid-template-columns:1fr 400px;gap:24px;align-items:start}
      .qrow{display:grid;grid-template-columns:28px 2fr 1.4fr 1fr 1fr 1fr 110px;padding:11px 16px;align-items:center}
      .qhead{display:grid;grid-template-columns:28px 2fr 1.4fr 1fr 1fr 1fr 110px;padding:8px 16px}
      .nav-tab{border-radius:6px;padding:5px 12px;font-size:12px;font-weight:500;letter-spacing:0;cursor:pointer;border:1px solid transparent;transition:background .12s,color .12s,border-color .12s;white-space:nowrap;font-family:inherit}
      .nav-tab:hover{background:rgba(255,255,255,0.05)}
      .nav-tab.active{background:#1e293b;border-color:#334155;color:#f1f5f9}
      .nav-tab.inactive{background:transparent;color:#94a3b8}
      .nav-tab.locked{background:transparent;color:#475569;cursor:default}
      .mode-card{transition:transform .18s,border-color .18s,background .18s;border-radius:12px;cursor:pointer}
      .mode-card:hover{transform:translateY(-3px)}
      .mode-print:hover{border-color:#ea580c!important;background:rgba(234,88,12,0.04)!important}
      .mode-laser:hover{border-color:#7c3aed!important;background:rgba(124,58,237,0.04)!important}
      .mode-card:active{transform:translateY(0)}
      .stat-card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center}
      .info-tile{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;text-align:center}
      .card-wrap{background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden}
      .card-header{padding:10px 16px;border-bottom:1px solid #334155;font-size:11px;color:#94a3b8;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center}
      .card-body{padding:16px;display:flex;flex-direction:column;gap:14px}
      .step-done{width:28px;height:28px;border-radius:50%;background:#16a34a;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600;flex-shrink:0}
      .step-active{width:28px;height:28px;border-radius:50%;background:#1e293b;border:2px solid #3b82f6;display:flex;align-items:center;justify-content:center;font-size:12px;color:#3b82f6;font-weight:600;flex-shrink:0}
      .step-idle{width:28px;height:28px;border-radius:50%;background:transparent;border:2px solid #334155;display:flex;align-items:center;justify-content:center;font-size:12px;color:#475569;font-weight:600;flex-shrink:0}
      .btn-primary{background:#2563eb;color:#fff;border:none;border-radius:6px;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:background .12s;letter-spacing:0}
      .btn-primary:hover{background:#1d4ed8}
      .btn-secondary{background:transparent;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:background .12s,color .12s}
      .btn-secondary:hover{background:#1e293b;color:#f1f5f9}
      .btn-print{background:#ea580c;color:#fff;border:none;border-radius:6px;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:background .12s}
      .btn-print:hover{background:#c2410c}
      .btn-laser{background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:background .12s}
      .btn-laser:hover{background:#6d28d9}
      .btn-danger{background:#dc2626;color:#fff;border:none;border-radius:6px;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:background .12s}
      .btn-danger:hover{background:#b91c1c}
      .badge{display:inline-flex;align-items:center;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase}
      .badge-queue{background:rgba(245,158,11,0.12);color:#f59e0b}
      .badge-print{background:rgba(59,130,246,0.12);color:#60a5fa}
      .badge-done{background:rgba(34,197,94,0.12);color:#4ade80}
      .badge-cancel{background:rgba(100,116,139,0.15);color:#94a3b8}
      .badge-pending{background:rgba(148,163,184,0.12);color:#cbd5e1}
      .badge-failed{background:rgba(239,68,68,0.12);color:#fca5a5}
      .badge-laser{background:rgba(124,58,237,0.12);color:#a78bfa}
      .badge-overdue{background:rgba(239,68,68,0.12);color:#f87171}
      .badge-soon{background:rgba(245,158,11,0.12);color:#fbbf24}
      @media(max-width:1024px){.g4{grid-template-columns:repeat(2,1fr)}.det{grid-template-columns:1fr}}
      @media(max-width:768px){.g4{grid-template-columns:1fr 1fr;gap:10px}.g2{grid-template-columns:1fr}.g2s{grid-template-columns:1fr}.g3{grid-template-columns:1fr 1fr}.gc2{grid-template-columns:1fr}.det{grid-template-columns:1fr}.qrow{grid-template-columns:28px 1fr auto}.qhead{display:none}.hmob{display:none}}
      @media(max-width:480px){.g4{grid-template-columns:1fr 1fr;gap:8px}.g3{grid-template-columns:1fr}}
      @media print{nav,.no-print{display:none!important}.print-only{display:block}}
    `}</style>

    {showConfetti&&<Confetti/>}
    {showCPw&&admin&&<ChangePasswordModal admin={admin} forced={admin.mustReset} onDone={function(a){setAdmin(a);setShowCPw(false);}} onCancel={function(){setShowCPw(false);}}/>}
    {showMA&&admin&&<ManageAdmins currentAdmin={admin} onClose={function(){setShowMA(false);}}/>}
    {showPrinterSettings&&<PrinterSettings onClose={function(){setShowPrinterSettings(false);}}/>}
    {showTemplates&&<TemplatesModal onUse={useTemplate} onClose={function(){setShowTemplates(false);}}/>}
    {showLaserInv&&<LaserConsumablesModal laserInv={laserInv} setLaserInv={setLaserInv} onClose={function(){setShowLaserInv(false);}}/>}
    {showSBSettings&&<SupabaseSettingsModal sbUrl={sbUrl} setSbUrl={setSbUrl} sbKey={sbKey} setSbKey={setSbKey} sbConnected={sbConnected} setSbConnected={setSbConnected} onClose={function(){setShowSBSettings(false);}}/>}

    {/* NAV */}
    <nav style={{ borderBottom:"1px solid #0d1220", background:"rgba(15,23,42,0.98)", backdropFilter:"blur(10px)", position:"sticky", top:0, zIndex:100 }}>
      <div style={{ maxWidth:1300, margin:"0 auto", padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{ width:32, height:32, background:"#ea580c", borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div><div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:900, letterSpacing:"-0.03em", color:"#fff", lineHeight:1 }}>PRINT<span style={{ color:"#f97316" }}>LAB</span></div><div style={{ fontSize:7, color:"#475569", letterSpacing:"0.14em" }}>MACC 3D PORTAL</div></div>
        </div>
        {isMobile?<button onClick={function(){setMobileMenu(function(m){return !m;});}} style={{ background:"none", border:"1px solid #111827", borderRadius:7, padding:"6px 10px", color:"#e2e8f0", cursor:"pointer", fontSize:16 }}>☰</button>
        :<div style={{ display:"flex", alignItems:"center", gap:5, overflow:"auto" }}>
          {TABS.map(function(tab){
            var v=tab[0],l=tab[1],req=tab[2];
            var active=view===v,locked=req&&!admin;
            return <button key={v} className="bh" onClick={function(){setView(v);setJobMode(null);setStep(0);setLaserStep(0);}} style={{ background:active?"#f97316":"transparent", color:active?"#fff":locked?"#475569":"#64748b", border:"1px solid "+(active?"#f97316":locked?"#1e293b":"#334155"), borderRadius:6, padding:"5px 10px", fontFamily:"inherit", fontSize:9, cursor:"pointer", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>{l}{locked?" 🔒":""}</button>;
          })}
          {admin&&<div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:4 }}>
            {!sbConnected&&<div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:5, padding:"3px 8px" }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:"#f59e0b" }}/>
              <div style={{ fontSize:9, color:"#f59e0b" }}>Local only</div>
              <button onClick={function(){setShowSBSettings(true);}} style={{ background:"none", border:"none", color:"#fbbf24", cursor:"pointer", fontSize:9, textDecoration:"underline", padding:0 }}>Connect</button>
            </div>}
            {sbConnected&&<div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(34,197,94,0.07)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:5, padding:"3px 8px" }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:"#22c55e" }}/>
              <div style={{ fontSize:9, color:"#4ade80" }}>Shared</div>
            </div>}
            <div style={{ display:"flex", alignItems:"center", gap:6, background:"#1e293b", border:"1px solid #111827", borderRadius:8, padding:"4px 8px 4px 5px" }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:"#ea580c", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:11, color:"#fff" }}>{admin.name.charAt(0)}</div>
            <div><div style={{ fontSize:9, color:"#e2e8f0", lineHeight:1 }}>{admin.name}</div><div style={{ fontSize:7, color:"#64748b" }}>{admin.role}</div></div>
            <div style={{ display:"flex", gap:3, marginLeft:3 }}>
              <button className="bh" onClick={function(){setShowCPw(true);}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#64748b", cursor:"pointer", fontSize:9 }}>🔑</button>
              <button className="bh" onClick={function(){setShowPrinterSettings(true);}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#64748b", cursor:"pointer", fontSize:9 }}>🖨️</button>
              {admin.role==="Head of STEM"&&<button className="bh" onClick={function(){setShowMA(true);}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#64748b", cursor:"pointer", fontSize:9 }}>👥</button>}
              <button className="bh" onClick={function(){setAdmin(null);setView("submit");}} style={{ background:"none", border:"1px solid #111827", borderRadius:4, padding:"2px 5px", color:"#64748b", cursor:"pointer", fontSize:9 }}>↩</button>
            </div>
            </div>
          </div>}
        </div>}
      </div>
      {isMobile&&mobileMenu&&<div style={{ borderTop:"1px solid #111827", background:"#162032", padding:"10px 16px", display:"flex", flexDirection:"column", gap:6 }}>
        {TABS.map(function(tab){var v=tab[0],l=tab[1],req=tab[2];var locked=req&&!admin;return <button key={v} className="bh" onClick={function(){setView(v);setMobileMenu(false);setJobMode(null);setStep(0);setLaserStep(0);}} style={{ background:view===v?"#f97316":"transparent", color:view===v?"#fff":locked?"#475569":"#64748b", border:"1px solid "+(view===v?"#f97316":"#334155"), borderRadius:6, padding:"8px 14px", fontFamily:"inherit", fontSize:11, cursor:"pointer", textAlign:"left" }}>{l}{locked?" 🔒":""}</button>;})}
      </div>}
    </nav>

    <div style={{ maxWidth:1300, margin:"0 auto", padding:"24px 16px" }}>

      {view==="stats"&&<PublicStats requests={requests}/>}
      {view==="status"&&<TeacherStatus requests={requests}/>}
      {isAdminView&&!admin&&<AdminLogin onLogin={handleLogin}/>}
      {view==="inventory"&&admin&&<FilamentInventory requests={requests} admin={admin}/>}
      {view==="laser-inv"&&admin&&<LaserInventoryPage laserInv={laserInv} setLaserInv={setLaserInv}/>}
      {view==="insights"&&admin&&<AdminInsights requests={requests}/>}
      {view==="report"&&admin&&<MonthlyReport requests={requests}/>}


      {/* ── SUBMIT / LASER WIZARD ── */}
      {view==="submit"&&<div>
        {/* ── Mode picker — shown when no job type chosen yet ── */}
        {!jobMode&&!submitted&&!laserSubmitted&&<div className="fu">
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900, letterSpacing:"-0.03em", marginBottom:6 }}>What would you like to make?</div>
            <div style={{ fontSize:13, color:"#64748b" }}>Choose the type of job you want to submit</div>
          </div>
          <div style={{ maxWidth:1100, margin:"0 auto", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:20 }}>
            <div className="mode-card mode-print" onClick={function(){setJobMode("print");}} style={{ background:"#1e293b", border:"2px solid #111827", borderRadius:16, padding:28, cursor:"pointer", textAlign:"center", transition:"border-color .2s, background .2s" }}>
              <div style={{ fontSize:52, marginBottom:14 }}>🖨️</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:22, color:"#f97316", marginBottom:8 }}>3D Print</div>
              <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.8, marginBottom:18 }}>Upload an STL file and we'll print it in your chosen material and colour on the Bambu X1C.</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7, textAlign:"left", marginBottom:20 }}>
                {["PLA, PETG, ABS, TPU filaments","84 colours across 6 filament types","Live 3D preview on upload","Estimated print time and cost"].map(function(f){return <div key={f} style={{ fontSize:11, color:"#64748b", display:"flex", gap:8, lineHeight:1.6 }}><span style={{ color:"#f97316", flexShrink:0 }}>✓</span>{f}</div>;})}
              </div>
              <div style={{ background:"#ea580c", color:"#fff", borderRadius:8, padding:"12px 0", fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:"0.08em", textTransform:"uppercase" }}>Start 3D Print Request →</div>
            </div>
            <div className="mode-card mode-laser" onClick={function(){setJobMode("laser");}} style={{ background:"#1e293b", border:"2px solid #111827", borderRadius:16, padding:28, cursor:"pointer", textAlign:"center", transition:"border-color .2s, background .2s" }}>
              <div style={{ fontSize:52, marginBottom:14 }}>🔴</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:22, color:"#a855f7", marginBottom:8 }}>Laser / Cut</div>
              <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.8, marginBottom:18 }}>Engrave or cut your design into wood, leather, acrylic and more with the Bambu H2D 40W laser.</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7, textAlign:"left", marginBottom:20 }}>
                {["40W blue laser — 310×250mm work area","Engrave, cut, or engrave then cut","Vinyl blade cutting for stickers & decals","SVG, PNG, PDF, DXF accepted"].map(function(f){return <div key={f} style={{ fontSize:11, color:"#64748b", display:"flex", gap:8, lineHeight:1.6 }}><span style={{ color:"#a855f7", flexShrink:0 }}>✓</span>{f}</div>;})}
              </div>
              <div style={{ background:"#7c3aed", color:"#fff", borderRadius:8, padding:"12px 0", fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:"0.08em", textTransform:"uppercase" }}>Start Laser Request →</div>
            </div>
            <div className="mode-card" onClick={function(){alert("CAD Services\n\nCAD (Computer-Aided Design) assistance is coming soon!\n\nThis service will offer:\n• Help preparing files for 3D printing\n• Tinkercad / Fusion 360 guidance\n• Model repair and optimisation\n• Design consultations\n\nContact the Print Lab team in the meantime.");}} style={{ background:"#1e293b", border:"2px solid #334155", borderRadius:16, padding:28, cursor:"pointer", textAlign:"center", opacity:0.8 }}>
              <div style={{ fontSize:52, marginBottom:14 }}>📐</div>
              <div style={{ fontFamily:"inherit", fontWeight:600, fontSize:22, color:"#94a3b8", marginBottom:8 }}>CAD Services</div>
              <div style={{ fontSize:12, color:"#475569", lineHeight:1.8, marginBottom:18 }}>Get help designing or preparing files for fabrication. Tinkercad, Fusion 360, and model repair assistance.</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7, textAlign:"left", marginBottom:20 }}>
                {["File preparation for 3D printing","Design consultation","Model repair and optimisation","Tinkercad and Fusion 360 support"].map(function(f){return <div key={f} style={{ fontSize:11, color:"#334155", display:"flex", gap:8, lineHeight:1.6 }}><span style={{ color:"#475569", flexShrink:0 }}>·</span>{f}</div>;})}
              </div>
              <div style={{ background:"#334155", color:"#64748b", borderRadius:8, padding:"12px 0", fontFamily:"inherit", fontSize:12, fontWeight:500 }}>Coming Soon</div>
            </div>
          </div>
          <div style={{ maxWidth:1100, margin:"20px auto 0", background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.15)", borderRadius:10, padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:20 }}>ℹ️</div>
            <div style={{ fontSize:11, color:"#64748b", lineHeight:1.7 }}>Not sure which to choose? <span style={{ color:"#60a5fa" }}>3D printing</span> creates physical objects from scratch. <span style={{ color:"#c084fc" }}>Laser cutting/engraving</span> marks or cuts flat materials. <span style={{ color:"#64748b" }}>CAD Services</span> is help preparing and designing files — coming soon.</div>
          </div>
        </div>}

        {/* ── Laser wizard (inline when laser mode chosen) ── */}
        {jobMode==="laser"&&!laserSubmitted&&<div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
            <button className="bh" onClick={function(){setJobMode(null);setLaserStep(0);}} style={{ background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:7, padding:"6px 14px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer" }}>← Back</button>
            <div style={{ fontSize:11, color:"#64748b" }}>New Request / Laser Cut</div>
          </div>
          <LaserWizard form={lform} setForm={setLform} step={laserStep} setStep={setLaserStep} submitted={laserSubmitted} confetti={laserConfetti} laserFile={laserFile} setLaserFile={setLaserFile} lfileRef={lfileRef} onSubmit={handleLaserSubmit} requests={requests} setFileData={setLaserFileData} setDims={setSvgDims} fileData={laserFileData} dims={svgDims}/>
        </div>}
        {jobMode==="laser"&&laserSubmitted&&<LaserWizard form={lform} setForm={setLform} step={laserStep} setStep={setLaserStep} submitted={laserSubmitted} confetti={laserConfetti} laserFile={laserFile} setLaserFile={setLaserFile} lfileRef={lfileRef} onSubmit={handleLaserSubmit} requests={requests} setFileData={setLaserFileData} setDims={setSvgDims} fileData={laserFileData} dims={svgDims}/>}

        {/* ── 3D Print wizard ── */}
        {jobMode==="print"&&(submitted?<div style={{ textAlign:"center", padding:"80px 0" }}>
          <div className="ci" style={{ fontSize:80, marginBottom:16 }}>🎉</div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900, color:"#22c55e" }}>You're all set!</div>
          <div style={{ color:"#64748b", marginTop:10, fontSize:14, lineHeight:1.8 }}>Your print request is in the queue.<br/>You'll get an email when printing starts.</div>
          {submittedReadyDate&&<div style={{ marginTop:16, background:"rgba(249,115,22,0.08)", border:"1px solid rgba(249,115,22,0.2)", borderRadius:10, padding:"12px 20px", display:"inline-block" }}>
            <div style={{ fontSize:10, color:"#f97316", letterSpacing:"0.1em", marginBottom:4 }}>ESTIMATED READY DATE</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"#f97316" }}>{formatReadyDate(submittedReadyDate)}</div>
            <div style={{ fontSize:10, color:"#64748b", marginTop:3 }}>Based on current queue — may change</div>
          </div>}
        </div>:
        <div style={{ maxWidth:720, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
            <button className="bh" onClick={function(){setJobMode(null);setStep(0);}} style={{ background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:7, padding:"6px 14px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer" }}>← Back</button>
            <div style={{ fontSize:11, color:"#64748b" }}>New Request / 3D Print</div>
          </div>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:24, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1.1, marginBottom:5 }}>
              {["👋 Let's get started!","📐 About your print","✅ Review & submit"][step]}
            </div>
            <div style={{ fontSize:12, color:"#64748b" }}>
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
                <div><Lbl>School email</Lbl><input value={form.email} placeholder="you@macc.nsw.edu.au" onChange={function(e){setForm(function(f){return Object.assign({},f,{email:e.target.value});});}} style={baseInput}/><div style={{ fontSize:10, color:"#64748b", marginTop:4 }}>We'll email you when your print is ready</div></div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.15)", borderRadius:8, cursor:"pointer" }} onClick={function(){setForm(function(f){return Object.assign({},f,{priority:!f.priority});});}}>
                <input type="checkbox" checked={form.priority} onChange={function(){}} style={{ width:16, height:16, accentColor:"#ef4444", cursor:"pointer" }}/>
                <div><div style={{ fontSize:12, fontWeight:500, color:form.priority?"#fca5a5":"#94a3b8" }}>Mark as Urgent</div><div style={{ fontSize:10, color:"#64748b" }}>Flags this job for priority attention in the admin queue</div></div>
              </div>
              <div><Lbl>Department</Lbl>
                <select value={form.department} onChange={function(e){setForm(function(f){return Object.assign({},f,{department:e.target.value});});}} style={selectStyle}>
                  <option value="">— Select your department —</option>
                  {DEPARTMENTS.map(function(d){return <option key={d} value={d}>{d}</option>;})}
                </select>
              </div>
            </Card>

            <Card title="Upload Your 3D File">
              <div style={{ background:"rgba(249,115,22,0.04)", border:"1px solid rgba(249,115,22,0.1)", borderRadius:8, padding:"10px 12px", fontSize:11, color:"#94a3b8", lineHeight:1.7 }}>
                <strong style={{ color:"#9ca3af" }}>What's an STL file?</strong> Export from Tinkercad, Fusion 360, Printables, etc. We'll auto-fill your project name from the file and URL.
              </div>
              <div>
                <Lbl>Source URL (optional)</Lbl>
                <div style={{ position:"relative" }}>
                  <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, pointerEvents:"none", opacity:0.5 }}>🔗</div>
                  <input value={form.sourceUrl} onChange={function(e){handleUrlInput(e.target.value);}} placeholder="https://www.printables.com/model/..." style={Object.assign({},baseInput,{paddingLeft:34,fontSize:12})}/>
                </div>
                {urlInfo&&<div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#22c55e" }}><span>✅</span><span>{urlInfo}</span></div>}
                <div style={{ fontSize:10, color:"#64748b", marginTop:4 }}>Supports Thingiverse, Printables, MyMiniFactory, MakerWorld, Cults3D, Tinkercad, Thangs</div>
              </div>
              <div style={{ borderTop:"1px solid #111827", paddingTop:14 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <Lbl>STL File *</Lbl>
                  <button className="bh" onClick={function(){if(fileRef.current)fileRef.current.click();}} style={{ background:"rgba(249,115,22,0.1)", color:"#f97316", border:"1px solid rgba(249,115,22,0.3)", borderRadius:6, padding:"4px 12px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.06em", textTransform:"uppercase", flexShrink:0 }}>📂 Browse Files</button>
                </div>
                <div ref={dragRef} onDragOver={function(e){e.preventDefault();if(dragRef.current)dragRef.current.classList.add("drag-over");}} onDragLeave={function(){if(dragRef.current)dragRef.current.classList.remove("drag-over");}} onDrop={onDrop} onClick={function(){if(fileRef.current)fileRef.current.click();}} style={{ border:"2px dashed", borderColor:stlFile?"#f97316":"#475569", borderRadius:12, padding:"28px 24px", textAlign:"center", cursor:"pointer", background:stlFile?"rgba(249,115,22,0.03)":"transparent", transition:"all .2s" }}>
                  <input ref={fileRef} type="file" accept=".stl,.3mf" style={{ display:"none" }} onChange={function(e){if(e.target.files&&e.target.files[0])handleFile(e.target.files[0]);}}/>
                  {parsing&&<div><div className="pulse" style={{ fontSize:30, marginBottom:10 }}>⚙️</div><div style={{ fontSize:13, color:"#f97316" }}>Analysing your design...</div></div>}
                  {!parsing&&stlFile&&<div>
                    <div style={{ fontSize:36, marginBottom:8 }}>📦</div>
                    <div style={{ fontSize:14, color:"#f97316", fontWeight:500 }}>{stlFile.name}</div>
                    <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>{(stlFile.size/1024).toFixed(1)} KB</div>
                    {stlStats&&checkBuildVolume(stlStats.dimensions).length>0&&<div style={{ marginTop:8, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:7, padding:"8px 12px" }}>
                      {checkBuildVolume(stlStats.dimensions).map(function(w,i){return <div key={i} style={{ fontSize:11, color:"#ef4444" }}>⚠️ {w}</div>;})}
                    </div>}
                    {stlStats&&getCx(stlStats.triangles).warn&&<div style={{ marginTop:8, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:7, padding:"8px 12px", fontSize:11, color:"#ef4444" }}>⚠️ Very high complexity ({stlStats.triangles.toLocaleString()} triangles) — slicing may take a while.</div>}
                    <button className="bh" onClick={function(e){e.stopPropagation();if(fileRef.current)fileRef.current.click();}} style={{ marginTop:8, background:"transparent", color:"#64748b", border:"1px solid #1f2937", borderRadius:5, padding:"4px 12px", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer" }}>Replace file</button>
                  </div>}
                  {!parsing&&!stlFile&&<div>
                    <div style={{ fontSize:44, marginBottom:10, opacity:0.3 }}>🖨️</div>
                    <div style={{ fontSize:14, color:"#64748b", marginBottom:4 }}>Drag your STL file here</div>
                    <div style={{ fontSize:11, color:"#64748b" }}>or use the Browse Files button above</div>
                  </div>}
                </div>
                {stlError&&<div style={{ background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"10px 12px", fontSize:11, color:"#ef4444", lineHeight:1.6, marginTop:8 }}>{stlError}</div>}
              </div>
            </Card>

            {stl3MFMeta&&stl3MFMeta.valid&&<div className="fu" style={{ background:"rgba(124,58,237,0.06)", border:"1px solid rgba(124,58,237,0.2)", borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, fontWeight:500, color:"#a78bfa", marginBottom:8 }}>3MF File Detected</div>
              <div style={{ fontSize:11, color:"#94a3b8", lineHeight:1.8 }}>
                {stl3MFMeta.layerHeight&&<div>Layer height: {stl3MFMeta.layerHeight}mm</div>}
                {stl3MFMeta.infill!==null&&<div>Infill density: {stl3MFMeta.infill}%</div>}
                {stl3MFMeta.material&&<div>Material: {stl3MFMeta.material}</div>}
                <div style={{ marginTop:4, fontSize:10, color:"#64748b" }}>Note: Full 3MF analysis (print time, weight) requires Bambu Studio slicing data. Estimates will not be shown for 3MF files.</div>
              </div>
            </div>}
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
                    <button className="bh" onClick={function(){setForm(function(f){return Object.assign({},f,{quantity:Math.max(1,f.quantity-1)});});}} style={{ width:36, height:36, border:"1px solid #111827", borderRadius:6, background:"#162032", color:"#e2e8f0", fontSize:18, cursor:"pointer", fontFamily:"inherit" }}>-</button>
                    <div style={{ flex:1, textAlign:"center", fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, color:"#f97316" }}>{form.quantity}</div>
                    <button className="bh" onClick={function(){setForm(function(f){return Object.assign({},f,{quantity:Math.min(50,f.quantity+1)});});}} style={{ width:36, height:36, border:"1px solid #111827", borderRadius:6, background:"#162032", color:"#e2e8f0", fontSize:18, cursor:"pointer", fontFamily:"inherit" }}>+</button>
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
            <FilamentPicker inv={inv} form={form} setForm={setForm} />
            <Card title="Any special instructions?">
              <textarea value={form.notes} rows={3} placeholder="e.g. needs to be strong, fragile parts, specific finish..." onChange={function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});}} style={Object.assign({},baseInput,{resize:"vertical",lineHeight:1.7})}/>
            </Card>
            <NavBtns onBack={function(){setStep(0);}} onNext={function(){setStep(2);}} disabled={!form.projectName||!form.dueDate||!form.color} label="Review my request"/>
          </div>}

          {/* Step 2 — Review */}
          {step===2&&<div className="fu" style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <Card title="Summary — does everything look right?">
              <div className="g2s" style={{ gap:10 }}>
                {[["Name",form.teacherName],["Email",form.email],["Department",form.department||"Not specified"],["Project",form.projectName],["Quantity","x"+form.quantity],["Due",form.dueDate?new Date(form.dueDate+"T00:00:00").toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long"}):"—"],["Material",form.material+" — "+form.color],["File",stlFile?stlFile.name:"—"],["Source URL",form.sourceUrl||"Not provided"]].map(function(pair){
                  return <div key={pair[0]} style={{ background:"#162032", borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:10, color:"#64748b", marginBottom:3 }}>{pair[0]}</div><div style={{ fontSize:12, color:"#9ca3af", wordBreak:"break-all" }}>{pair[1]}</div></div>;
                })}
              </div>
              {form.notes&&<div style={{ background:"#162032", borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:10, color:"#64748b", marginBottom:3 }}>Notes</div><div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.7 }}>{form.notes}</div></div>}
              {stlStats&&<div style={{ background:"rgba(249,115,22,0.06)", border:"1px solid rgba(249,115,22,0.12)", borderRadius:8, padding:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div><div style={{ fontSize:10, color:"#64748b", marginBottom:2 }}>Estimated print time</div><div style={{ fontSize:20, fontFamily:"'Syne',sans-serif", fontWeight:900, color:"#f97316" }}>{fmtH(stlStats.estimatedHours*form.quantity*0.85)}</div></div>
                <div style={{ textAlign:"right" }}><div style={{ fontSize:10, color:"#64748b", marginBottom:2 }}>Est. filament</div><div style={{ fontSize:12, color:"#94a3b8" }}>{estWeight(stlStats,form.material,form.quantity).toFixed(0)}g</div></div>
              </div>}
            </Card>
            <div style={{ background:"rgba(34,197,94,0.06)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#22c55e" }}>
              ✉ After submitting, your email client will open with a confirmation message to send yourself.
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button className="bh" onClick={function(){setStep(1);}} style={{ flex:"0 0 auto", background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:8, padding:"12px 20px", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>← Edit</button>
              <button className="bh" onClick={function(){saveTemplate().then(function(){});handleSubmit();sendConfirmEmail(Object.assign({},form,{fileName:stlFile?stlFile.name:"",id:"new"}),estimateReadyDate(requests,{stlStats:stlStats,quantity:form.quantity}));}} style={{ flex:1, background:"#ea580c", color:"#fff", border:"none", borderRadius:8, padding:"14px 0", fontFamily:"inherit", fontSize:13, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer" }}>🚀 Submit Print Request</button>
            </div>
          </div>}
        </div>)}
      </div>}

      {/* ── QUEUE ── */}
      {view==="log"&&admin&&<div className="fu">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:10, marginBottom:20 }}>
          <StatCard emoji="📋" value={""+requests.length} label="Total" color="#94a3b8"/>
          <StatCard emoji="⏸" value={""+qs.pend} label="Pending" color="#94a3b8"/>
          <StatCard emoji="⏳" value={""+qs.q} label="Queued" color="#f59e0b"/>
          <StatCard emoji="🖨️" value={""+qs.p} label="Printing" color="#3b82f6"/>
          <StatCard emoji="✅" value={""+qs.d} label="Done" color="#22c55e"/>
          <StatCard emoji="⚠️" value={""+qs.f} label="Failed" color="#ef4444"/>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:18, fontWeight:600, color:"#f1f5f9" }}>Print Queue</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={function(){exportCSV(requests);}} className="bh" style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"6px 14px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Export CSV</button>
              {admin&&admin.role==="Head of STEM"&&<button onClick={function(){setShowLaserInv(true);}} className="bh" style={{ background:"#1e293b", color:"#a78bfa", border:"1px solid #334155", borderRadius:6, padding:"6px 14px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Laser Consumables</button>}
              {admin&&<button onClick={function(){setShowSBSettings(true);}} className="bh" style={{ background:"#1e293b", color:"#64748b", border:"1px solid #334155", borderRadius:6, padding:"6px 14px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Shared Queue</button>}
            </div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
            <input value={searchQuery} onChange={function(e){setSearchQuery(e.target.value);}} placeholder="Search by name, teacher, department, material..." style={Object.assign({},baseInput,{flex:1,fontSize:12,padding:"7px 12px"})}/>
            {searchQuery&&<button onClick={function(){setSearchQuery("");}} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:16 }}>×</button>}
          </div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {["All"].concat(STATUSES).map(function(s){var active=filterStatus===s,col=SC[s]||"#94a3b8";return <button key={s} className="bh" onClick={function(){setFilterStatus(s);}} style={{ background:active?col:"transparent", color:active?"#fff":"#64748b", border:"1px solid "+(active?col:"#334155"), borderRadius:5, padding:"4px 10px", fontFamily:"inherit", fontSize:10, cursor:"pointer" }}>{s}{s==="Pending"&&qs.pend>0?" ("+qs.pend+")":s==="Failed"&&qs.f>0?" ("+qs.f+")":""}</button>;})}
          </div>
        </div>
        {loading?<div className="pulse" style={{ color:"#f97316", fontSize:12, padding:"50px 0", textAlign:"center" }}>Loading...</div>
        :filtered.length===0?<div style={{ textAlign:"center", padding:"60px 0" }}><div style={{ fontSize:44, marginBottom:12, opacity:0.15 }}>🖨️</div><div style={{ fontSize:14, color:"#475569" }}>No {filterStatus!=="All"?filterStatus.toLowerCase():""} requests yet</div></div>
        :<div className="det">
          <div style={{ background:"#1e293b", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
            {selCount>0&&<div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px", background:"rgba(37,99,235,0.08)", borderBottom:"1px solid rgba(37,99,235,0.2)" }}>
              <div style={{ fontSize:12, color:"#60a5fa", flex:1 }}>{selCount} job{selCount!==1?"s":""} selected</div>
              <button onClick={batchApprove} className="bh" style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>Approve All</button>
              <button onClick={batchCancel} className="bh" style={{ background:"rgba(245,158,11,0.12)", color:"#f59e0b", border:"1px solid rgba(245,158,11,0.3)", borderRadius:6, padding:"5px 12px", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>Cancel All</button>
              <button onClick={batchDelete} className="bh" style={{ background:"rgba(239,68,68,0.1)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.3)", borderRadius:6, padding:"5px 12px", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>Delete All</button>
              <button onClick={function(){setSelected({});}} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:14 }}>×</button>
            </div>}
            {!isMobile&&<div className="qhead" style={{ borderBottom:"1px solid #334155" }}>
              <input type="checkbox" style={{ width:14, height:14, accentColor:"#2563eb" }} onChange={selectAll} checked={selCount>0&&selCount===filtered.length}/>
              {["Project","Teacher","Due","Est. Time","Qty","Status"].map(function(h){return <div key={h} style={{ fontSize:10, color:"#64748b", fontWeight:500 }}>{h}</div>;})}
            </div>}
            {filtered.map(function(req,i){
              var due=req.dueDate?new Date(req.dueDate+"T00:00:00"):null;
              var dl=due?Math.ceil((due-Date.now())/86400000):null;
              var over=dl!==null&&dl<0&&!["Done","Cancelled"].includes(req.status);
              var soon=dl!==null&&dl<=2&&dl>=0&&!["Done","Cancelled"].includes(req.status);
              var isSel=selReq&&selReq.id===req.id;
              var isChecked=!!selected[req.id];
              // Mobile card layout
              if (isMobile) return <div key={req.id} className="rh" onClick={function(){setSelReq(isSel?null:req);}} style={{ background:isSel?"rgba(59,130,246,0.06)":"#1e293b", border:"1px solid "+(isSel?"rgba(59,130,246,0.3)":"#334155"), borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:4 }}>
                      {req.jobCategory==="laser"&&<span className="badge badge-laser">LASER</span>}
                      {req.priority&&<span className="badge" style={{ background:"rgba(239,68,68,0.15)", color:"#fca5a5" }}>URGENT</span>}
                      {req.status==="Pending"&&<span className="badge badge-pending">PENDING</span>}
                      {req.status==="Failed"&&<span className="badge badge-failed">FAILED</span>}
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:"#f1f5f9", marginBottom:3 }}>{req.projectName}</div>
                    <div style={{ fontSize:11, color:"#64748b" }}>{req.teacherName}{req.department?" · "+req.department:""}</div>
                    {req.fileName&&<div style={{ fontSize:10, color:"#475569", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{req.fileName}</div>}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6, flexShrink:0 }}>
                    <span style={{ background:SC[req.status]+"20", color:SC[req.status], border:"1px solid "+SC[req.status]+"40", borderRadius:4, padding:"3px 8px", fontSize:9, letterSpacing:"0.06em", textTransform:"uppercase" }}>{req.status}</span>
                    {due&&<div style={{ fontSize:10, color:over?"#ef4444":soon?"#f59e0b":"#64748b" }}>Due {due.toLocaleDateString("en-AU",{day:"numeric",month:"short"})}</div>}
                    <input type="checkbox" checked={isChecked} onChange={function(e){toggleSelect(req.id,e);}} onClick={function(e){e.stopPropagation();}} style={{ width:16, height:16, accentColor:"#2563eb" }}/>
                  </div>
                </div>
              </div>;
              // Desktop row
              return <div key={req.id} className="rh qrow" onClick={function(){setSelReq(isSel?null:req);}}
                draggable={true}
                onDragStart={function(e){e.dataTransfer.setData("text/plain",req.id);e.currentTarget.style.opacity="0.5";}}
                onDragEnd={function(e){e.currentTarget.style.opacity="1";}}
                onDragOver={function(e){e.preventDefault();e.currentTarget.style.background="rgba(59,130,246,0.08)";}}
                onDragLeave={function(e){e.currentTarget.style.background=isSel?"rgba(249,115,22,0.04)":"transparent";}}
                onDrop={function(e){e.preventDefault();e.currentTarget.style.background="transparent";var fromId=e.dataTransfer.getData("text/plain");if(fromId&&fromId!==req.id){var fromIdx=requests.findIndex(function(r){return r.id===fromId;});var toIdx=requests.findIndex(function(r){return r.id===req.id;});if(fromIdx>=0&&toIdx>=0){var reordered=requests.slice();var item=reordered.splice(fromIdx,1)[0];reordered.splice(toIdx,0,item);setRequests(reordered);saveReqs(reordered);}}}}
                style={{ borderBottom:i<filtered.length-1?"1px solid #162032":"none", background:isSel?"rgba(59,130,246,0.04)":"transparent", cursor:"grab" }}>
                <input type="checkbox" checked={isChecked} onChange={function(e){toggleSelect(req.id,e);}} onClick={function(e){e.stopPropagation();}} style={{ width:14, height:14, accentColor:"#2563eb", cursor:"pointer" }}/>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {req.jobCategory==="laser"&&<span className="badge badge-laser">LASER</span>}
                    {req.priority&&<span className="badge" style={{ background:"rgba(239,68,68,0.15)", color:"#fca5a5" }}>URGENT</span>}
                    {req.status==="Pending"&&<span className="badge badge-pending">PENDING REVIEW</span>}
                    {req.status==="Failed"&&<span className="badge badge-failed">FAILED</span>}
                    <span style={{ fontSize:13, color:"#f1f5f9", fontWeight:500 }}>{req.projectName}</span>
                    {over&&<span style={{ fontSize:8, background:"rgba(239,68,68,0.15)", color:"#ef4444", borderRadius:3, padding:"2px 5px" }}>OVERDUE</span>}
                    {soon&&<span style={{ fontSize:8, background:"rgba(245,158,11,0.15)", color:"#f59e0b", borderRadius:3, padding:"2px 5px" }}>DUE SOON</span>}
                  </div>
                  <div style={{ fontSize:9, color:"#475569", marginTop:1 }}>{req.fileName}</div>
                </div>
                <div className="hmob"><div style={{ fontSize:12, color:"#94a3b8" }}>{req.teacherName}</div><div style={{ fontSize:9, color:"#475569" }}>{req.department||req.email}</div></div>
                <div className="hmob" style={{ fontSize:11, color:over?"#ef4444":soon?"#f59e0b":"#64748b" }}>{due?due.toLocaleDateString("en-AU",{day:"numeric",month:"short"}):"—"}</div>
                <div className="hmob" style={{ fontSize:11, color:req.stlStats?"#f97316":"#475569" }}>{req.stlStats?fmtH(req.stlStats.estimatedHours*req.quantity*0.85):"—"}</div>
                <div className="hmob" style={{ fontSize:11, color:"#64748b" }}>x{req.quantity}</div>
                <div><span style={{ background:SC[req.status]+"20", color:SC[req.status], border:"1px solid "+SC[req.status]+"40", borderRadius:4, padding:"3px 8px", fontSize:8, letterSpacing:"0.07em", textTransform:"uppercase" }}>{req.status}</span></div>
              </div>;
            })}
          </div>

          {selReq&&<div className="fu" style={{ background:"#1e293b", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
            <div style={{ borderBottom:"1px solid #111827", padding:"12px 15px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:12 }}>REQUEST DETAIL</span>
              <button onClick={function(){setSelReq(null);}} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
            </div>
            <div style={{ padding:16, display:"flex", flexDirection:"column", gap:13 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <div style={{ fontSize:15, fontWeight:600, color:"#f1f5f9" }}>{selReq.projectName}</div>
                  {selReq.priority&&<span className="badge" style={{ background:"rgba(239,68,68,0.15)", color:"#fca5a5" }}>URGENT</span>}
                  {selReq.jobCategory==="laser"&&<span className="badge badge-laser">LASER</span>}
                  {selReq.status==="Pending"&&<span className="badge badge-pending">AWAITING APPROVAL</span>}
                </div>
                {selReq.purpose&&<div style={{ fontSize:12, color:"#64748b", marginTop:4, lineHeight:1.6 }}>{selReq.purpose}</div>}
                <div style={{ fontSize:10, color:"#475569", marginTop:4 }}>Submitted {new Date(selReq.submittedAt).toLocaleString()}</div>
              </div>

              {selReq.status==="Printing"&&selReq.printStartedAt&&(selReq.stlStats||selReq.jobCategory==="laser")&&<div style={{ background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.18)", borderRadius:10, padding:12 }}>
                <div style={{ fontSize:10, color:"#64748b", marginBottom:8, fontWeight:500 }}>Live Print Countdown</div>
                <Countdown startedAt={selReq.printStartedAt} totalHours={selReq.stlStats ? selReq.stlStats.estimatedHours*(selReq.quantity||1)*0.85 : (function(){var w=selReq.designWidth||(selReq.svgDimsMM?selReq.svgDimsMM.wMM:100);var h=selReq.designHeight||(selReq.svgDimsMM?selReq.svgDimsMM.hMM:100);var factor=selReq.jobType==="Engrave"?1.0:selReq.jobType==="Cut"?0.4:selReq.jobType==="Engrave & Cut"?1.5:0.3;return Math.max(5,Math.round((parseFloat(w)*parseFloat(h))/(800*60)*60*factor*(selReq.quantity||1)))/60;})()} />
              </div>}

              <div className="g2s" style={{ gap:7 }}>
                {[["Teacher",selReq.teacherName],["Email",selReq.email],["Dept.",selReq.department||"—"],["Due",selReq.dueDate?new Date(selReq.dueDate+"T00:00:00").toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short"}):"—"],["Material",selReq.material],["Colour",selReq.color],["Qty","x"+selReq.quantity],["File",selReq.fileName]].map(function(pair){
                  return <div key={pair[0]} style={{ background:"#162032", borderRadius:7, padding:"8px 10px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:3 }}>{pair[0]}</div><div style={{ fontSize:11, color:"#94a3b8", wordBreak:"break-all" }}>{pair[1]}</div></div>;
                })}
              </div>

              {selReq.sourceUrl&&<div style={{ background:"#162032", borderRadius:7, padding:"8px 10px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:3 }}>Source URL</div><a href={selReq.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#3b82f6", wordBreak:"break-all" }}>{selReq.sourceUrl}</a></div>}

              {selReq.notes&&<div style={{ background:"#162032", border:"1px solid #111827", borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:9, color:"#475569", marginBottom:4 }}>NOTES</div><div style={{ fontSize:11, color:"#64748b", lineHeight:1.7 }}>{selReq.notes}</div></div>}

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
                      return <div key={row[0]} style={{ display:"flex", justifyContent:"space-between" }}><span style={{ fontSize:11, color:row[2]==="warn"?"#ef4444":"#64748b" }}>{row[0]}</span><span style={{ fontSize:12, color:row[2]===true?"#f97316":row[2]==="warn"?"#ef4444":"#9ca3af", fontWeight:row[2]===true?500:400 }}>{row[1]}</span></div>;
                    });
                  })()}
                </div>
              </div>}

              {selReq.fileData&&<div style={{ background:"#162032", borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontSize:10, color:"#64748b", marginBottom:2 }}>Design file stored</div><div style={{ fontSize:11, color:"#94a3b8" }}>{selReq.fileName}</div></div>
                <button className="bh" onClick={function(){downloadDataURL(selReq.fileData, selReq.fileName);}} style={{ background:"#1e293b", color:"#3b82f6", border:"1px solid #334155", borderRadius:6, padding:"6px 12px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Download</button>
              </div>}
              {!selReq.fileData&&selReq.fileName&&<div style={{ background:"#162032", border:"1px dashed #334155", borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontSize:10, color:"#64748b", marginBottom:2 }}>File not stored (too large or uploaded before v2)</div><div style={{ fontSize:11, color:"#94a3b8" }}>{selReq.fileName}</div></div>
                <button className="bh" onClick={function(){window.open("mailto:"+selReq.email+"?subject="+encodeURIComponent("Re: "+selReq.projectName+" - Please resend file")+"&body="+encodeURIComponent("Hi "+selReq.teacherName+",\nCould you please resend your file "+selReq.fileName+" so we can start your print?\n\nThanks,\nPrint Lab"));}} style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"6px 12px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Request file</button>
              </div>}
              {(function(){
                var check = selReq.stlStats && selReq.status==="Queued" ? checkFilamentSufficiency(inv, selReq) : null;
                if(!check) return null;
                var col = check.ok===true?"#4ade80":check.ok==="warn"?"#fbbf24":"#fca5a5";
                var bg = check.ok===true?"rgba(34,197,94,0.06)":check.ok==="warn"?"rgba(245,158,11,0.06)":"rgba(239,68,68,0.06)";
                return <div style={{ background:bg, border:"1px solid "+col+"44", borderRadius:8, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:col, fontWeight:500, marginBottom:2 }}>{check.ok===true?"✓ Filament sufficient":check.ok==="warn"?"⚠ Cutting it close":"✗ Insufficient filament"}</div>
                  <div style={{ fontSize:11, color:"#94a3b8" }}>{check.msg}</div>
                </div>;
              })()}
              {selReq.status==="Done"&&<div style={{ display:"flex", gap:8 }}>
                <button onClick={function(){generateICS(selReq,new Date());}} className="bh" style={{ flex:1, background:"rgba(34,197,94,0.08)", color:"#22c55e", border:"1px solid rgba(34,197,94,0.25)", borderRadius:7, padding:"9px 0", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.07em", textTransform:"uppercase" }}>📅 Add to Calendar</button>
                <div style={{ flex:1, background:"#162032", border:"1px solid #111827", borderRadius:7, padding:"9px", textAlign:"center" }}>
                  <img src={generateQR("Print "+selReq.projectName+" is ready! Collect from Print Lab.")} alt="QR" style={{ width:60, height:60, borderRadius:4 }}/>
                  <div style={{ fontSize:8, color:"#64748b", marginTop:3 }}>QR for pickup</div>
                </div>
              </div>}
              {selReq.status==="Done"&&selReq.jobCategory!=="laser"&&<button className="bh" onClick={function(){reprintJob(selReq);}} style={{ width:"100%", background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:7, padding:"9px 0", fontFamily:"inherit", fontSize:11, cursor:"pointer", textAlign:"center" }}>Reprint this job →</button>}

              {selReq.log&&selReq.log.length>0&&<div style={{ background:"#162032", border:"1px solid #111827", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", marginBottom:6 }}>ACTIVITY</div>
                {selReq.log.map(function(l,i){return <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}><span style={{ fontSize:10, color:"#64748b" }}>{l.msg}{l.by?" — "+l.by:""}</span><span style={{ fontSize:9, color:"#475569" }}>{new Date(l.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span></div>;})}
              </div>}

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {selReq.status==="Queued"&&(!confStart
                  ?<button className="bh" onClick={function(){setConfStart(true);}} style={{ background:"#2563eb", color:"#fff", border:"none", borderRadius:8, padding:"12px 0", fontFamily:"inherit", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Start Print + Notify Teacher</button>
                  :<div style={{ background:"rgba(59,130,246,0.07)", border:"1px solid rgba(59,130,246,0.25)", borderRadius:8, padding:13 }}>
                    <div style={{ fontSize:11, color:"#60a5fa", marginBottom:8, lineHeight:1.7 }}>Opens your email client for <strong style={{ color:"#fff" }}>{selReq.email}</strong></div>
                    <div style={{ marginBottom:10 }}><Lbl>Note to teacher (optional)</Lbl><textarea value={adminNote} onChange={function(e){setAdminNote(e.target.value);}} rows={2} placeholder="e.g. Starting after 2pm today..." style={Object.assign({},smallInput,{resize:"vertical",lineHeight:1.6})}/></div>
                    <div style={{ display:"flex", gap:8 }}>
                      <button className="bh" onClick={function(){startPrint(selReq);}} style={{ flex:1, background:"#3b82f6", color:"#fff", border:"none", borderRadius:7, padding:"10px 0", fontFamily:"inherit", fontSize:10, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Confirm & Send</button>
                      <button className="bh" onClick={function(){setConfStart(false);setAdminNote("");}} style={{ flex:1, background:"transparent", color:"#64748b", border:"1px solid #111827", borderRadius:7, padding:"10px 0", fontFamily:"inherit", fontSize:10, cursor:"pointer" }}>Cancel</button>
                    </div>
                  </div>
                )}
                {selReq.status==="Printing"&&<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <div style={{ marginBottom:4 }}><Lbl>Note to teacher (optional)</Lbl><textarea value={adminNote} onChange={function(e){setAdminNote(e.target.value);}} rows={2} placeholder="e.g. Slight delay..." style={Object.assign({},smallInput,{resize:"vertical",lineHeight:1.6})}/></div>
                  <button className="bh" onClick={function(){markDone(selReq);}} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:8, padding:"12px 0", fontFamily:"inherit", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Mark Done + Send Pickup Email</button>
                  <button className="bh" onClick={function(){sendStartEmail(selReq,admin,adminNote);}} style={{ background:"transparent", color:"#3b82f6", border:"1px solid rgba(59,130,246,0.25)", borderRadius:7, padding:"9px 0", fontFamily:"inherit", fontSize:10, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>Resend Start Notification</button>
                </div>}
                <div>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", marginBottom:6 }}>MANUAL STATUS</div>
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
