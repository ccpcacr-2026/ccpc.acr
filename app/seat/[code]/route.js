export const dynamic = 'force-dynamic';

export async function GET(req, context) {
  const params = await context.params;
  const code = decodeURIComponent(String((params && params.code) || '')).trim();
  const { searchParams } = new URL(req.url);
  const circularParam = parseInt(searchParams.get('c') || '', 10) || 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=2">
  <title>3D Seat Finder — CCPC Exam Hall Guide</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #f8fafc; min-height: 100vh; overflow-x: hidden; }
    .wrap { max-width: 1020px; margin: 0 auto; padding: 14px 12px 44px; }
    .hero { background: linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#0f766e 100%); border: 1px solid rgba(255,255,255,0.14); border-radius: 22px; padding: 18px 20px; margin-bottom: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
    .hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .college { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #93c5fd; }
    .sname { font-size: 21px; font-weight: 900; color: #fff; margin: 4px 0 2px; }
    .smeta { font-size: 12px; color: #cbd5e1; font-weight: 600; }
    .seat-badges { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
    .sbadge { background: rgba(255,255,255,0.1); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.16); border-radius: 14px; padding: 10px 12px; }
    .sbadge .k { font-size: 9px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #93c5fd; }
    .sbadge .v { font-size: 16px; font-weight: 900; color: #fff; margin-top: 2px; }
    .sbadge.hi { background: linear-gradient(135deg,rgba(16,185,129,0.28),rgba(5,150,105,0.4)); border-color: #34d399; }
    .tabs { display: flex; gap: 8px; margin-bottom: 14px; background: #111827; padding: 5px; border-radius: 16px; border: 1px solid #1e293b; }
    .tab-btn { flex: 1; padding: 11px 10px; border-radius: 12px; border: none; background: transparent; color: #94a3b8; font-size: 12px; font-weight: 900; cursor: pointer; transition: all 0.2s; }
    .tab-btn.active { background: linear-gradient(135deg,#2563eb,#1d4ed8); color: #fff; box-shadow: 0 6px 18px rgba(37,99,235,0.4); }
    .panel { background: #111827; border: 1px solid #1e293b; border-radius: 22px; padding: 16px; margin-bottom: 14px; }
    .hidden { display: none !important; }

    /* Interactive 3D Viewport */
    .stage-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill-btn { padding: 7px 12px; border-radius: 10px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.15s; }
    .pill-btn.on, .pill-btn:hover { background: #2563eb; border-color: #3b82f6; color: #fff; }
    .pill-btn.play { background: linear-gradient(135deg,#10b981,#059669); border-color: #34d399; color: #fff; }

    .scene-3d { position: relative; width: 100%; min-height: 460px; background: radial-gradient(circle at 50% 30%, #1e293b 0%, #0b1222 80%); border-radius: 18px; border: 1px solid #1e293b; overflow: hidden; display: flex; align-items: center; justify-content: center; perspective: 1250px; touch-action: none; user-select: none; cursor: grab; }
    .scene-3d:active { cursor: grabbing; }
    .drag-tip { position: absolute; bottom: 10px; right: 12px; font-size: 10px; font-weight: 700; color: #cbd5e1; background: rgba(15,23,42,0.86); padding: 5px 11px; border-radius: 999px; pointer-events: none; border: 1px solid #334155; z-index: 20; }
    .room-legend { position: absolute; bottom: 10px; left: 12px; display: flex; gap: 10px; align-items: center; font-size: 10px; font-weight: 700; color: #cbd5e1; background: rgba(15,23,42,0.86); padding: 5px 11px; border-radius: 999px; pointer-events: none; border: 1px solid #334155; z-index: 20; }
    .leg-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; margin-right: 4px; vertical-align: middle; }

    /* 3D Campus Wayfinding Map */
    .campus-world { position: relative; width: 640px; height: 390px; transform-style: preserve-3d; transition: transform 0.35s ease-out; }
    .campus-ground { position: absolute; inset: 0; background: linear-gradient(135deg,#132032,#0f172a); border: 2px solid #334155; border-radius: 20px; box-shadow: 0 32px 65px rgba(0,0,0,0.7); }
    .road-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; transform: translateZ(2px); }
    .bldg-3d { position: absolute; transform-style: preserve-3d; transition: all 0.35s; }
    .bldg-top { width: 100%; height: 100%; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 900; font-size: 12px; border: 2px solid #475569; background: #1e293b; color: #cbd5e1; box-shadow: 0 10px 25px rgba(0,0,0,0.45); transform: translateZ(34px); position: relative; }
    .bldg-3d.target .bldg-top { background: linear-gradient(135deg,#059669,#10b981); border-color: #6ee7b7; color: #fff; transform: translateZ(56px); box-shadow: 0 0 34px rgba(16,185,129,0.7); }
    .bldg-side-front { position: absolute; left: 0; right: 0; bottom: 0; height: 34px; background: #0f172a; border: 1px solid #334155; transform-origin: bottom; transform: rotateX(-90deg); }
    .bldg-3d.target .bldg-side-front { height: 56px; background: linear-gradient(180deg,#047857,#064e3b); border-color: #34d399; }
    .bldg-side-right { position: absolute; top: 0; bottom: 0; right: 0; width: 34px; background: #172033; border: 1px solid #334155; transform-origin: right; transform: rotateY(-90deg); }
    .bldg-3d.target .bldg-side-right { width: 56px; background: linear-gradient(270deg,#065f46,#064e3b); border-color: #34d399; }
    .bldg-beacon { position: absolute; left: 50%; top: 50%; transform-origin: center bottom; transform: translate(-50%,-100%) translateZ(66px) rotateX(-52deg); background: linear-gradient(135deg,#f59e0b,#d97706); color: #0f172a; font-size: 11px; font-weight: 900; padding: 5px 12px; border-radius: 999px; white-space: nowrap; box-shadow: 0 10px 24px rgba(245,158,11,0.55); border: 2px solid #fef3c7; pointer-events: none; }
    .bldg-beacon::after { content: ''; position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); border: 5px solid transparent; border-top-color: #f59e0b; }
    .gate-node { position: absolute; left: 26px; bottom: 26px; background: linear-gradient(135deg,#2563eb,#1d4ed8); border: 2px solid #93c5fd; color: #fff; font-size: 11px; font-weight: 900; padding: 6px 12px; border-radius: 10px; transform: translateZ(14px); box-shadow: 0 8px 20px rgba(37,99,235,0.5); }

    /* Step Cards */
    .steps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 8px; margin-top: 12px; }
    .step-card { background: #1e293b; border: 1.5px solid #334155; border-radius: 14px; padding: 10px 12px; cursor: pointer; transition: all 0.2s; }
    .step-card.active { background: rgba(16,185,129,0.16); border-color: #34d399; }
    .step-num { font-size: 9px; font-weight: 900; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.7px; }
    .step-card.active .step-num { color: #34d399; }
    .step-txt { font-size: 12px; font-weight: 800; color: #f1f5f9; margin-top: 3px; line-height: 1.35; }

    /* ===================================================================
       REALISTIC 3D ARCHITECTURAL CLASSROOM STAGE
       =================================================================== */
    .room-world {
      position: relative;
      transform-style: preserve-3d;
      transition: transform 0.28s ease-out;
      margin-top: 26px;
      padding: 82px 54px 38px 58px;
      background-color: #f4f6f9;
      background-image:
        linear-gradient(to right, rgba(148,163,184,0.22) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(148,163,184,0.22) 1px, transparent 1px),
        radial-gradient(circle at 50% 45%, rgba(255,255,255,0.7), rgba(226,232,240,0.4));
      background-size: 38px 38px, 38px 38px, 100% 100%;
      border: 3px solid #64748b;
      border-radius: 4px;
      box-shadow: 0 42px 80px rgba(0,0,0,0.75);
      color: #0f172a;
    }

    /* Floor Foundation Slab (extrudes downward -18px under the floor) */
    .room-slab-front {
      position: absolute; left: -3px; right: -3px; bottom: -21px; height: 18px;
      background: linear-gradient(180deg,#475569,#1e293b);
      border-top: 2px solid #94a3b8;
      transform-origin: top center;
      transform: rotateX(-90deg);
    }
    .room-slab-left {
      position: absolute; top: -3px; bottom: -3px; left: -21px; width: 18px;
      background: linear-gradient(90deg,#1e293b,#334155);
      transform-origin: right center;
      transform: rotateY(-90deg);
    }
    .room-slab-right {
      position: absolute; top: -3px; bottom: -3px; right: -21px; width: 18px;
      background: linear-gradient(270deg,#1e293b,#334155);
      transform-origin: left center;
      transform: rotateY(90deg);
    }

    /* 3D Extruded Classroom Walls (standing straight UP +88px above the floor!) */
    .room-wall-front {
      position: absolute; top: -91px; left: -3px; right: -3px; height: 88px;
      background: linear-gradient(180deg, #cbd5e1 0%, #f1f5f9 22%, #e2e8f0 84%, #64748b 84%, #475569 100%);
      border: 2px solid #94a3b8;
      border-bottom: none;
      transform-origin: bottom center;
      transform: rotateX(-90deg);
      transform-style: preserve-3d;
      box-shadow: inset 0 -10px 20px rgba(15,23,42,0.12);
    }
    .room-wall-left {
      position: absolute; top: -3px; bottom: -3px; left: -91px; width: 88px;
      background: linear-gradient(90deg, #cbd5e1 0%, #e8eef5 20%, #dbe4f0 84%, #64748b 84%, #475569 100%);
      border: 2px solid #94a3b8;
      transform-origin: right center;
      transform: rotateY(90deg);
      transform-style: preserve-3d;
      box-shadow: inset -10px 0 20px rgba(15,23,42,0.12);
    }
    .room-wall-right {
      position: absolute; top: -3px; bottom: -3px; right: -91px; width: 88px;
      background: linear-gradient(270deg, #cbd5e1 0%, #eef2f7 20%, #dce5f0 84%, #64748b 84%, #475569 100%);
      border: 2px solid #94a3b8;
      transform-origin: left center;
      transform: rotateY(-90deg);
      transform-style: preserve-3d;
      box-shadow: inset 10px 0 20px rgba(15,23,42,0.1);
    }
    .wall-room-sign {
      position: absolute; top: 10px; left: 16px;
      background: #1e293b; color: #f8fafc; font-size: 9px; font-weight: 900;
      letter-spacing: 0.8px; padding: 3px 8px; border-radius: 4px;
      border: 1px solid #475569; text-transform: uppercase;
    }

    /* 3D Wall-Mounted Whiteboard / Chalkboard */
    .wall-board-3d {
      position: absolute; top: 14px; height: 50px; width: 42%; min-width: 190px; max-width: 280px;
      transform: translateX(-50%) translateZ(4px);
      background: linear-gradient(135deg, #14532d 0%, #166534 55%, #15803d 100%);
      border: 4px solid #cbd5e1;
      border-bottom: 6px solid #94a3b8;
      border-radius: 4px;
      box-shadow: 0 8px 16px rgba(15,23,42,0.28);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: #f0fdf4; font-weight: 900; font-size: 11px; letter-spacing: 0.8px;
    }
    .wall-board-3d small { font-size: 8px; font-weight: 700; opacity: 0.8; letter-spacing: 0.5px; margin-top: 2px; }

    /* 3D Wall Door Frame (anchored to floor seam of Left/Right/Front wall) */
    .wall-door-left {
      position: absolute; right: 0; width: 64px; height: 58px;
      transform: translateY(-50%) translateZ(3px);
      background: linear-gradient(90deg, #92400e 0%, #b45309 55%, #78350f 100%);
      border: 4px solid #451a03;
      border-right: none;
      border-radius: 4px 0 0 4px;
      box-shadow: 0 6px 14px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    }
    .wall-door-left span {
      writing-mode: vertical-rl; transform: rotate(180deg);
      color: #fef3c7; font-size: 8px; font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase;
    }
    .wall-door-right {
      position: absolute; left: 0; width: 64px; height: 58px;
      transform: translateY(-50%) translateZ(3px);
      background: linear-gradient(270deg, #92400e 0%, #b45309 55%, #78350f 100%);
      border: 4px solid #451a03;
      border-left: none;
      border-radius: 0 4px 4px 0;
      box-shadow: 0 6px 14px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    }
    .wall-door-right span {
      writing-mode: vertical-rl;
      color: #fef3c7; font-size: 8px; font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase;
    }
    .wall-door-top {
      position: absolute; bottom: 0; width: 52px; height: 64px;
      transform: translateX(-50%) translateZ(3px);
      background: linear-gradient(180deg, #b45309, #78350f);
      border: 4px solid #451a03; border-bottom: none; border-radius: 4px 4px 0 0;
      display: flex; align-items: center; justify-content: center;
      color: #fef3c7; font-size: 8px; font-weight: 900;
    }

    /* 3D Glass Windows on Side Walls (centered mid-wall above baseboard) */
    .wall-win-right, .wall-win-left {
      position: absolute; width: 42px; height: 136px;
      transform: translateY(-50%) translateZ(3px);
      background: linear-gradient(180deg, #bae6fd 0%, #38bdf8 50%, #7dd3fc 100%);
      border: 4px solid #f8fafc;
      border-radius: 3px;
      box-shadow: inset 0 0 12px rgba(2,132,199,0.35), 0 0 18px rgba(56,189,248,0.28);
      display: grid; grid-template-rows: 1fr 1fr 1fr; gap: 3px; padding: 3px;
    }
    .wall-win-right { left: 26px; }
    .wall-win-left { right: 26px; }
    .wall-win-pane { background: rgba(255,255,255,0.38); border-radius: 1px; }

    /* Floor Threshold Mat for Door + Floating Door Tag */
    .door-mat {
      position: absolute; z-index: 6; transform: translateZ(3px);
      background: linear-gradient(135deg,#f59e0b,#d97706); color: #fff;
      font-size: 9px; font-weight: 900; padding: 4px 9px; border-radius: 6px;
      border: 1.5px solid #fef3c7; box-shadow: 0 4px 12px rgba(245,158,11,0.45);
      white-space: nowrap; letter-spacing: 0.4px;
    }

    /* 3D Extruded Teacher's Desk in Front Zone */
    .teacher-desk-3d {
      position: absolute; top: 16px; width: 96px; height: 34px;
      transform-style: preserve-3d; z-index: 5;
    }
    .td-top {
      position: absolute; inset: 0; transform: translateZ(24px);
      background: linear-gradient(135deg,#92400e,#78350f);
      border: 1.5px solid #d97706; border-radius: 5px;
      color: #fef3c7; font-size: 9px; font-weight: 900;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 14px rgba(0,0,0,0.28);
    }
    .td-front {
      position: absolute; left: 0; right: 0; bottom: 0; height: 24px;
      background: linear-gradient(180deg,#5c2808,#3b1804);
      transform-origin: bottom; transform: rotateX(-90deg);
    }
    .td-side {
      position: absolute; top: 0; bottom: 0; right: 0; width: 24px;
      background: #451a03;
      transform-origin: right; transform: rotateY(-90deg);
    }
    .td-shadow {
      position: absolute; inset: 3px -3px -4px 4px; background: rgba(15,23,42,0.22); border-radius: 6px;
    }

    /* Front Corridor Label */
    .front-corridor-hint {
      position: absolute; top: 54px; left: 50%; transform: translateX(-50%) translateZ(1px);
      font-size: 8px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase;
      color: #94a3b8; pointer-events: none; white-space: nowrap;
    }

    /* Classroom Columns & Open Aisles */
    .room-cols { display: flex; align-items: flex-start; gap: 10px; position: relative; z-index: 4; transform-style: preserve-3d; }
    .room-col { display: flex; flex-direction: column; gap: 10px; min-width: 78px; transform-style: preserve-3d; }
    .col-hdr {
      text-align: center; font-size: 10px; font-weight: 900; color: #334155;
      background: rgba(226,232,240,0.9); border: 1px solid #cbd5e1; border-radius: 6px; padding: 3px 6px;
      transform: translateZ(2px);
    }
    .aisle-gap { width: 28px; align-self: stretch; display: flex; align-items: center; justify-content: center; position: relative; }
    .aisle-strip { width: 16px; height: 100%; background: rgba(148,163,184,0.12); border-left: 1.5px dashed #cbd5e1; border-right: 1.5px dashed #cbd5e1; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
    .aisle-lbl { writing-mode: vertical-rl; font-size: 8px; font-weight: 900; letter-spacing: 2px; color: #94a3b8; opacity: 0.7; }

    /* True 3D Extruded Student Desks & Chairs */
    .desk-3d {
      position: relative; height: 48px; min-width: 78px;
      transform-style: preserve-3d;
      transition: transform 0.25s;
    }
    .desk-shadow {
      position: absolute; top: 5px; left: 3px; right: -3px; bottom: 0;
      background: rgba(15,23,42,0.18); border-radius: 6px;
    }
    .desk-top {
      position: absolute; top: 2px; left: 0; right: 0; height: 32px;
      transform: translateZ(18px);
      background: linear-gradient(180deg, #fffdf7 0%, #f6e7cb 100%);
      border: 1.5px solid #c9a673;
      border-radius: 5px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 900; color: #475569;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.85);
    }
    .desk-front {
      position: absolute; top: 16px; left: 0; right: 0; height: 18px;
      background: linear-gradient(180deg, #c69f68, #a37c48);
      border-bottom: 1px solid #855f32;
      transform-origin: bottom center;
      transform: rotateX(-90deg);
    }
    .desk-side-r {
      position: absolute; top: 2px; right: 0; width: 18px; height: 32px;
      background: linear-gradient(270deg, #b08954, #8f6a3b);
      transform-origin: right center;
      transform: rotateY(-90deg);
    }
    .desk-side-l {
      position: absolute; top: 2px; left: 0; width: 18px; height: 32px;
      background: linear-gradient(90deg, #c49d66, #a37c48);
      transform-origin: left center;
      transform: rotateY(90deg);
    }
    /* Student Chair behind desk */
    .desk-chair {
      position: absolute; bottom: 1px; left: 14px; right: 14px; height: 9px;
      transform: translateZ(12px);
      background: linear-gradient(180deg, #64748b, #475569);
      border: 1px solid #334155;
      border-radius: 3px;
      box-shadow: 0 3px 6px rgba(15,23,42,0.25);
    }

    /* Disabled Desk Spot */
    .desk-disabled {
      height: 48px; min-width: 78px; border-radius: 6px;
      background: repeating-linear-gradient(45deg,rgba(203,213,225,0.5),rgba(203,213,225,0.5) 4px,transparent 4px,transparent 9px);
      border: 1.5px dashed #94a3b8;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 800; color: #94a3b8;
    }

    /* Highlighted Student's Own 3D Desk */
    .desk-3d.mine { z-index: 12; }
    .desk-3d.mine .desk-shadow {
      top: -4px; left: -6px; right: -6px; bottom: -4px;
      background: radial-gradient(circle, rgba(16,185,129,0.55) 0%, rgba(16,185,129,0.12) 65%, transparent 100%);
      border: 2px solid #10b981; border-radius: 10px;
      animation: floorPulse 1.8s ease-in-out infinite;
    }
    .desk-3d.mine .desk-top {
      transform: translateZ(26px);
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border: 2px solid #a7f3d0;
      color: #ffffff;
      box-shadow: 0 0 28px rgba(16,185,129,0.85), inset 0 1px 0 rgba(255,255,255,0.45);
    }
    .desk-3d.mine .desk-front {
      top: 8px; height: 26px;
      background: linear-gradient(180deg, #047857, #064e3b);
      border-bottom: 1px solid #022c22;
    }
    .desk-3d.mine .desk-side-r {
      width: 26px;
      background: linear-gradient(270deg, #065f46, #064e3b);
    }
    .desk-3d.mine .desk-side-l {
      width: 26px;
      background: linear-gradient(90deg, #059669, #047857);
    }
    .desk-3d.mine .desk-chair {
      transform: translateZ(16px);
      background: linear-gradient(180deg, #059669, #065f46);
      border-color: #6ee7b7;
    }

    /* Standing Upright 3D Beacon Pin above Your Seat */
    .you-pin-3d {
      position: absolute; left: 50%; top: 14px;
      transform-origin: center bottom;
      transform: translate(-50%,-100%) translateZ(34px) rotateX(-52deg);
      display: flex; flex-direction: column; align-items: center;
      pointer-events: none; z-index: 20;
    }
    .you-pin-pill {
      background: linear-gradient(135deg,#f59e0b,#d97706);
      color: #0f172a; font-size: 10px; font-weight: 900;
      padding: 4px 11px; border-radius: 999px; white-space: nowrap;
      border: 2px solid #fef3c7;
      box-shadow: 0 10px 22px rgba(245,158,11,0.6);
    }
    .you-pin-stem {
      width: 3px; height: 14px; background: linear-gradient(180deg,#f59e0b,#10b981);
      border-radius: 2px;
    }

    /* Floor Walking Path SVG (strictly on the floor surface, underneath raised desks) */
    .room-path-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3; transform: translateZ(3px); }

    @keyframes floorPulse { 0%,100%{ opacity: 0.7; transform: scale(1); } 50%{ opacity: 1; transform: scale(1.06); } }
    @keyframes dashMove { to { stroke-dashoffset: -40; } }
    .anim-route { stroke-dasharray: 10 8; animation: dashMove 1.1s linear infinite; }

    .err-box { background: #1e293b; border: 1px solid #ef4444; border-radius: 20px; padding: 32px 20px; text-align: center; }
    .err-box h2 { color: #fca5a5; margin-bottom: 8px; }
    .search-mini { display: flex; gap: 8px; max-width: 360px; margin: 16px auto 0; }
    .search-mini input { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: #fff; font-weight: 700; }
    .search-mini button { padding: 10px 16px; border-radius: 10px; border: none; background: #2563eb; color: #fff; font-weight: 900; cursor: pointer; }

    @media (max-width: 640px) {
      .seat-badges { grid-template-columns: 1fr; }
      .scene-3d { min-height: 380px; }
      .room-legend { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="appRoot">
      <div class="panel" style="text-align:center;padding:48px 20px;color:#94a3b8;font-weight:800">Loading your 3D Exam Hall &amp; Seat Map…</div>
    </div>
  </div>
  <script>
    const CODE = ${JSON.stringify(code)};
    const CIRC = ${JSON.stringify(circularParam)};
    let DATA = null;
    let TAB = 'way';
    let CAM = { rx: 52, rz: -18, scale: 0.86 };
    let CAMPUS_CAM = { rx: 52, rz: -24, scale: 0.86 };
    let WALK_TIMER = null;
    let ACTIVE_STEP = 0;

    function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function getSlots(layout){
      const cols = layout.columns || [];
      const dis = new Set(layout.disabled || []);
      const order = layout.fill_order || 'col_tb';
      const maxR = cols.reduce((m,c)=>Math.max(m, parseInt(c.rows,10)||0), 0);
      const slots = [];
      const push = (c,r) => { if (r >= (parseInt(cols[c]?.rows,10)||0) || dis.has(c+':'+r)) return; slots.push({ seatNo: slots.length+1, col: c, row: r }); };
      if (order === 'col_tb') { for (let c=0;c<cols.length;c++) for (let r=0;r<(cols[c].rows||0);r++) push(c,r); }
      else if (order === 'col_snake') { for (let c=0;c<cols.length;c++) { const l=cols[c].rows||0; if (c%2===0) for(let r=0;r<l;r++) push(c,r); else for(let r=l-1;r>=0;r--) push(c,r); } }
      else if (order === 'row_lr') { for (let r=0;r<maxR;r++) for (let c=0;c<cols.length;c++) push(c,r); }
      else if (order === 'row_snake') { for (let r=0;r<maxR;r++) { if (r%2===0) for(let c=0;c<cols.length;c++) push(c,r); else for(let c=cols.length-1;c>=0;c--) push(c,r); } }
      return slots;
    }

    async function load() {
      try {
        const url = '/api/seat-finder?code=' + encodeURIComponent(CODE) + (CIRC ? '&c=' + CIRC : '');
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok || json.error) {
          document.getElementById('appRoot').innerHTML = '<div class="err-box"><h2>Seat Not Found</h2><p style="color:#cbd5e1;font-size:13px">' + esc(json.error || 'Invalid ID') + '</p><form class="search-mini" onsubmit="event.preventDefault();var v=this.q.value.trim();if(v)location.href=\\'/seat/\\'+encodeURIComponent(v);"><input name="q" placeholder="Try Index ID or Tracking ID" value="' + esc(CODE) + '"><button type="submit">Find</button></form></div>';
          return;
        }
        DATA = json;
        render();
      } catch (e) {
        document.getElementById('appRoot').innerHTML = '<div class="err-box"><h2>Connection Error</h2><p style="color:#cbd5e1">Please refresh the page.</p></div>';
      }
    }

    function setTab(t) {
      TAB = t;
      render();
      if (t === 'room') setTimeout(drawRoomPath, 60);
    }

    function setCamPreset(kind) {
      if (TAB === 'room') {
        if (kind === 'iso') CAM = { rx: 52, rz: -18, scale: 0.86 };
        else if (kind === 'door') CAM = { rx: 58, rz: -34, scale: 0.88 };
        else if (kind === 'front') CAM = { rx: 60, rz: 0, scale: 0.88 };
        else if (kind === 'top') CAM = { rx: 0, rz: 0, scale: 0.92 };
        applyTransform();
      } else {
        if (kind === 'iso') CAMPUS_CAM = { rx: 52, rz: -24, scale: 0.86 };
        else if (kind === 'front') CAMPUS_CAM = { rx: 62, rz: 0, scale: 0.9 };
        else if (kind === 'top') CAMPUS_CAM = { rx: 0, rz: 0, scale: 0.92 };
        applyTransform();
      }
    }

    function zoomCam(delta) {
      const target = TAB === 'room' ? CAM : CAMPUS_CAM;
      target.scale = Math.max(0.45, Math.min(1.5, target.scale + delta));
      applyTransform();
    }

    function applyTransform() {
      const rw = document.getElementById('roomWorld3D');
      if (rw) {
        rw.style.transform = 'scale(' + CAM.scale + ') rotateX(' + CAM.rx + 'deg) rotateZ(' + CAM.rz + 'deg)';
        const pin = rw.querySelector('.you-pin-3d');
        if (pin) {
          pin.style.transform = CAM.rx < 10
            ? 'translate(-50%,-115%) translateZ(34px)'
            : 'translate(-50%,-100%) translateZ(34px) rotateZ(' + (-CAM.rz) + 'deg) rotateX(' + (-CAM.rx) + 'deg)';
        }
      }
      const cw = document.getElementById('campusWorld3D');
      if (cw) {
        cw.style.transform = 'scale(' + CAMPUS_CAM.scale + ') rotateX(' + CAMPUS_CAM.rx + 'deg) rotateZ(' + CAMPUS_CAM.rz + 'deg)';
        const bc = cw.querySelector('.bldg-beacon');
        if (bc) {
          bc.style.transform = CAMPUS_CAM.rx < 10
            ? 'translate(-50%,-115%) translateZ(66px)'
            : 'translate(-50%,-100%) translateZ(66px) rotateZ(' + (-CAMPUS_CAM.rz) + 'deg) rotateX(' + (-CAMPUS_CAM.rx) + 'deg)';
        }
      }
    }

    function wireDrag(elId, isRoom) {
      const el = document.getElementById(elId);
      if (!el) return;
      let dragging = false, sx = 0, sy = 0;
      const down = (x, y) => { dragging = true; sx = x; sy = y; };
      const move = (x, y) => {
        if (!dragging) return;
        const dx = x - sx, dy = y - sy;
        sx = x; sy = y;
        const c = isRoom ? CAM : CAMPUS_CAM;
        c.rz = Math.max(-70, Math.min(70, c.rz + dx * 0.35));
        c.rx = Math.max(0, Math.min(72, c.rx - dy * 0.35));
        applyTransform();
      };
      const up = () => { dragging = false; };
      el.onmousedown = e => down(e.clientX, e.clientY);
      window.onmousemove = e => move(e.clientX, e.clientY);
      window.onmouseup = up;
      el.ontouchstart = e => { if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY); };
      el.ontouchmove = e => { if (e.touches.length === 1) { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); } };
      el.ontouchend = up;
    }

    function highlightStep(idx) {
      ACTIVE_STEP = idx;
      document.querySelectorAll('.step-card').forEach((c, i) => c.classList.toggle('active', i === idx));
      if (idx === 4 && TAB !== 'room') { setTab('room'); }
    }

    function playGuidedWalk() {
      if (WALK_TIMER) { clearInterval(WALK_TIMER); WALK_TIMER = null; }
      TAB = 'way';
      ACTIVE_STEP = 0;
      render();
      let step = 0;
      WALK_TIMER = setInterval(() => {
        step++;
        if (step <= 3) {
          ACTIVE_STEP = step;
          document.querySelectorAll('.step-card').forEach((c, i) => c.classList.toggle('active', i === step));
        } else if (step === 4) {
          ACTIVE_STEP = 4;
          TAB = 'room';
          render();
          setTimeout(drawRoomPath, 80);
          clearInterval(WALK_TIMER);
          WALK_TIMER = null;
        }
      }, 1500);
    }

    function drawRoomPath() {
      const world = document.getElementById('roomWorld3D');
      const svg = document.getElementById('roomPathSvg');
      const myDesk = document.getElementById('myDeskCard');
      const colsEl = document.getElementById('roomColsWrap');
      const doorEl = document.querySelector('.fx-door-anchor');
      if (!world || !svg || !myDesk || !colsEl) return;

      const relPos = (node) => {
        let x = 0, y = 0, cur = node;
        while (cur && cur !== world) { x += cur.offsetLeft; y += cur.offsetTop; cur = cur.offsetParent; }
        return { x, y, w: node.offsetWidth, h: node.offsetHeight, cx: x + node.offsetWidth / 2, cy: y + node.offsetHeight / 2 };
      };

      const target = relPos(myDesk);
      const colsBox = relPos(colsEl);
      const doorBox = doorEl ? relPos(doorEl) : { cx: 22, cy: 62 };
      const doorWall = (doorEl && doorEl.dataset && doorEl.dataset.wall) || 'left';

      // Collect all real open walkway X coordinates (left wall edge, every aisle, right wall edge)
      const corridorsX = [Math.max(18, colsBox.x - 18)];
      world.querySelectorAll('.aisle-gap').forEach(ag => { corridorsX.push(relPos(ag).cx); });
      corridorsX.push(Math.min(world.offsetWidth - 18, colsBox.x + colsBox.w + 18));

      // Choose the open aisle/corridor closest to the student's desk!
      let bestAisleX = corridorsX[0];
      let bestDist = Infinity;
      corridorsX.forEach(cx => {
        const d = Math.abs(cx - target.cx);
        if (d < bestDist) { bestDist = d; bestAisleX = cx; }
      });

      // Choose front corridor (in front of desks) or back corridor (behind desks)
      const frontY = Math.max(46, colsBox.y - 16);
      const backY = Math.min(world.offsetHeight - 16, colsBox.y + colsBox.h + 16);
      const useBack = (doorWall === 'bottom') || (doorBox.cy > colsBox.y + colsBox.h * 0.65);
      const corridorY = useBack ? backY : frontY;

      // Build clean corridor-following path: Door -> Hallway -> Open Aisle -> Turn into Desk
      const pts = [];
      pts.push({ x: doorBox.cx, y: doorBox.cy });
      if (doorWall === 'left' || doorWall === 'right') {
        const wallWalkX = doorWall === 'left' ? Math.max(18, colsBox.x - 18) : Math.min(world.offsetWidth - 18, colsBox.x + colsBox.w + 18);
        if (Math.abs(bestAisleX - wallWalkX) < 12) {
          // Student is right next to the door's wall walkway — walk straight along wall walkway to student's row!
          pts.push({ x: wallWalkX, y: doorBox.cy });
          pts.push({ x: wallWalkX, y: target.cy });
        } else {
          // Walk along wall to front/back walkway -> across to student's open aisle -> straight down aisle to student's row
          pts.push({ x: wallWalkX, y: corridorY });
          pts.push({ x: bestAisleX, y: corridorY });
          pts.push({ x: bestAisleX, y: target.cy });
        }
      } else {
        // Door on top or bottom wall
        pts.push({ x: doorBox.cx, y: corridorY });
        pts.push({ x: bestAisleX, y: corridorY });
        pts.push({ x: bestAisleX, y: target.cy });
      }
      pts.push({ x: target.cx, y: target.cy });

      const d = pts.map((p, i) => (i === 0 ? 'M ' : 'L ') + Math.round(p.x) + ' ' + Math.round(p.y)).join(' ');

      svg.setAttribute('viewBox', '0 0 ' + world.offsetWidth + ' ' + world.offsetHeight);
      svg.innerHTML =
        '<path d="' + d + '" fill="none" stroke="rgba(16,185,129,0.28)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="' + d + '" fill="none" stroke="#10b981" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="anim-route"/>' +
        '<circle cx="' + Math.round(pts[0].x) + '" cy="' + Math.round(pts[0].y) + '" r="6" fill="#f59e0b" stroke="#fff" stroke-width="2"/>' +
        '<circle cx="' + Math.round(target.cx) + '" cy="' + Math.round(target.cy) + '" r="7" fill="#10b981" stroke="#fff" stroke-width="2"/>';
    }

    function renderCampusHtml() {
      const s = DATA.seat;
      const code = (s.building_code || 'SB').toUpperCase();
      const bldgs = [
        { code: 'MB', name: 'Main Building (MB)', x: 220, y: 245, w: 185, h: 74, cx: 312, cy: 282 },
        { code: 'SB', name: 'School Building (SB)', x: 85, y: 78, w: 195, h: 86, cx: 182, cy: 121 },
        { code: 'CB', name: 'College Building (CB)', x: 355, y: 75, w: 195, h: 86, cx: 452, cy: 118 },
        { code: 'JB', name: 'Junior Block (JB)', x: 455, y: 235, w: 145, h: 76, cx: 527, cy: 273 },
        { code: 'HB', name: 'Honors Building (HB)', x: 255, y: 18, w: 130, h: 48, cx: 320, cy: 42 },
      ];
      const tgt = bldgs.find(b => b.code === code) || bldgs[1];
      const routeD = 'M 75 340 L 180 340 L 180 205 L ' + tgt.cx + ' 205 L ' + tgt.cx + ' ' + tgt.cy;

      const bHtml = bldgs.map(b => {
        const isT = b.code === tgt.code;
        return '<div class="bldg-3d' + (isT ? ' target' : '') + '" style="left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px">' +
          '<div class="bldg-side-front"></div>' +
          '<div class="bldg-side-right"></div>' +
          '<div class="bldg-top">' +
            '<div>' + esc(b.code) + '</div>' +
            '<div style="font-size:9px;opacity:0.85;font-weight:700">' + esc(b.name.replace(/\\s*\\([^)]*\\)/, '')) + '</div>' +
          '</div>' +
          (isT ? '<div class="bldg-beacon">📍 Room ' + esc(s.room_name) + ' · ' + esc(s.floor_label) + '</div>' : '') +
        '</div>';
      }).join('');

      const steps = [
        { n: 'Step 1 · Entry', t: 'Enter through CCPC Main Gate with your Admit Card.' },
        { n: 'Step 2 · Building', t: 'Walk along the main path to ' + s.building + ' (' + s.building_code + ').' },
        { n: 'Step 3 · Floor', t: 'Take the stairs to ' + s.floor_label + '.' },
        { n: 'Step 4 · Exam Hall', t: 'Locate Room ' + s.room_name + ' and enter through the door.' },
        { n: 'Step 5 · Your Desk', t: 'Go to ' + (s.col_label || 'your column') + (s.row_number ? ', Row ' + s.row_number : '') + ' — Seat #' + s.seat_no + '.' },
      ];

      return '<div class="panel">' +
        '<div class="stage-bar">' +
          '<div style="font-size:13px;font-weight:900;color:#e2e8f0">🧭 3D Wayfinding to ' + esc(s.building) + ' — Room ' + esc(s.room_name) + '</div>' +
          '<div class="btn-row">' +
            '<button class="pill-btn play" onclick="playGuidedWalk()">▶ Play Guided Walk</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'iso\\')">3D View</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'top\\')">2D Top</button>' +
            '<button class="pill-btn" onclick="zoomCam(0.12)">+</button>' +
            '<button class="pill-btn" onclick="zoomCam(-0.12)">−</button>' +
          '</div>' +
        '</div>' +
        '<div id="campusScene" class="scene-3d">' +
          '<div id="campusWorld3D" class="campus-world">' +
            '<div class="campus-ground"></div>' +
            '<svg class="road-svg" viewBox="0 0 640 390">' +
              '<path d="' + routeD + '" fill="none" stroke="rgba(16,185,129,0.25)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="' + routeD + '" fill="none" stroke="#34d399" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" class="anim-route"/>' +
              '<circle cx="' + tgt.cx + '" cy="' + tgt.cy + '" r="9" fill="#f59e0b" stroke="#fff" stroke-width="2.5"/>' +
            '</svg>' +
            '<div class="gate-node">🏫 MAIN GATE</div>' +
            bHtml +
          '</div>' +
          '<div class="drag-tip">👆 Drag to rotate 3D campus map</div>' +
        '</div>' +
        '<div class="steps-grid">' +
          steps.map((st, i) => '<div class="step-card' + (ACTIVE_STEP === i ? ' active' : '') + '" onclick="highlightStep(' + i + ')"><div class="step-num">' + esc(st.n) + '</div><div class="step-txt">' + esc(st.t) + '</div></div>').join('') +
        '</div>' +
      '</div>';
    }

    function renderRoom3dHtml() {
      const s = DATA.seat;
      const lay = DATA.room_layout || { columns: [], disabled: [], fixtures: [] };
      const slots = getSlots(lay);
      const dis = new Set(lay.disabled || []);
      const numByCR = {};
      slots.forEach(sl => { numByCR[sl.col + ':' + sl.row] = sl.seatNo; });
      const cols = lay.columns || [];
      const maxR = cols.reduce((m, c) => Math.max(m, parseInt(c.rows, 10) || 0), 0);

      const colsHtml = cols.map((col, ci) => {
        const cr = parseInt(col.rows, 10) || 0;
        let desks = '';
        for (let r = 0; r < maxR; r++) {
          if (r >= cr) { desks += '<div style="height:48px"></div>'; continue; }
          const k = ci + ':' + r;
          if (dis.has(k)) { desks += '<div class="desk-disabled">Empty</div>'; continue; }
          const sn = numByCR[k] || '';
          const isMine = sn === s.seat_no;
          desks += '<div ' + (isMine ? 'id="myDeskCard" ' : '') + 'class="desk-3d' + (isMine ? ' mine' : '') + '">' +
            '<div class="desk-shadow"></div>' +
            '<div class="desk-front"></div>' +
            '<div class="desk-side-r"></div>' +
            '<div class="desk-side-l"></div>' +
            '<div class="desk-top">' +
              '<div>' + (isMine ? 'SEAT #' + sn : '#' + sn) + '</div>' +
              (isMine ? '<div style="font-size:8px;opacity:0.92;font-weight:800">Row ' + (r + 1) + '</div>' : '') +
            '</div>' +
            '<div class="desk-chair"></div>' +
            (isMine ? '<div class="you-pin-3d"><div class="you-pin-pill">📍 YOUR SEAT #' + sn + '</div><div class="you-pin-stem"></div></div>' : '') +
          '</div>';
        }
        const aisle = (col.aisle_after && ci < cols.length - 1)
          ? '<div class="aisle-gap"><div class="aisle-strip"><span class="aisle-lbl">AISLE</span></div></div>'
          : '';
        return '<div class="room-col" data-col-idx="' + ci + '"><div class="col-hdr">' + esc(col.label || ('Col ' + (ci + 1))) + '</div>' + desks + '</div>' + aisle;
      }).join('');

      // Distribute architectural fixtures onto the real 3D Walls & Front Floor Zone
      const fixtures = lay.fixtures || [];
      let frontWallHtml = '<div class="wall-room-sign">ROOM ' + esc(s.room_name) + '</div>';
      let leftWallHtml = '';
      let rightWallHtml = '';
      let floorExtrasHtml = '';
      let hasBoard = false;
      let hasDoorAnchor = false;

      fixtures.forEach(f => {
        const pos = Math.max(10, Math.min(90, parseInt(f.pos, 10) || 50));
        const lbl = f.label || f.type;
        if (f.type === 'board') {
          hasBoard = true;
          frontWallHtml += '<div class="wall-board-3d" style="left:' + pos + '%"><span>' + esc(lbl) + '</span><small>FRONT OF EXAM HALL</small></div>';
        } else if (f.type === 'desk') {
          const leftPct = Math.max(10, Math.min(82, pos));
          floorExtrasHtml += '<div class="teacher-desk-3d" style="left:' + leftPct + '%;transform:translateX(-50%)">' +
            '<div class="td-shadow"></div><div class="td-front"></div><div class="td-side"></div>' +
            '<div class="td-top">🧑‍🏫 ' + esc(lbl) + '</div>' +
          '</div>';
        } else if (f.type === 'door') {
          const anchorCls = !hasDoorAnchor ? ' fx-door-anchor' : '';
          hasDoorAnchor = true;
          if (f.wall === 'left') {
            leftWallHtml += '<div class="wall-door-left" style="top:' + pos + '%"><span>' + esc(lbl) + '</span></div>';
            floorExtrasHtml += '<div class="door-mat' + anchorCls + '" data-wall="left" style="left:6px;top:' + pos + '%;transform:translateY(-50%) translateZ(3px)">🚪 ' + esc(lbl) + '</div>';
          } else if (f.wall === 'right') {
            rightWallHtml += '<div class="wall-door-right" style="top:' + pos + '%"><span>' + esc(lbl) + '</span></div>';
            floorExtrasHtml += '<div class="door-mat' + anchorCls + '" data-wall="right" style="right:6px;top:' + pos + '%;transform:translateY(-50%) translateZ(3px)">🚪 ' + esc(lbl) + '</div>';
          } else if (f.wall === 'top') {
            frontWallHtml += '<div class="wall-door-top" style="left:' + pos + '%">' + esc(lbl) + '</div>';
            floorExtrasHtml += '<div class="door-mat' + anchorCls + '" data-wall="top" style="top:8px;left:' + pos + '%;transform:translateX(-50%) translateZ(3px)">🚪 ' + esc(lbl) + '</div>';
          } else {
            floorExtrasHtml += '<div class="door-mat' + anchorCls + '" data-wall="bottom" style="bottom:6px;left:' + pos + '%;transform:translateX(-50%) translateZ(3px)">🚪 ' + esc(lbl) + '</div>';
          }
        } else if (f.type === 'window') {
          if (f.wall === 'left') {
            leftWallHtml += '<div class="wall-win-left" style="top:' + pos + '%"><div class="wall-win-pane"></div><div class="wall-win-pane"></div><div class="wall-win-pane"></div></div>';
          } else {
            rightWallHtml += '<div class="wall-win-right" style="top:' + pos + '%"><div class="wall-win-pane"></div><div class="wall-win-pane"></div><div class="wall-win-pane"></div></div>';
          }
        }
      });

      if (!hasBoard) {
        frontWallHtml += '<div class="wall-board-3d" style="left:50%"><span>WHITEBOARD</span><small>FRONT OF EXAM HALL</small></div>';
      }

      return '<div class="panel">' +
        '<div class="stage-bar">' +
          '<div style="font-size:13px;font-weight:900;color:#e2e8f0">🪑 3D Classroom Room View — Room ' + esc(s.room_name) + '</div>' +
          '<div class="btn-row">' +
            '<button class="pill-btn" onclick="setCamPreset(\\'iso\\')">3D Room</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'door\\')">Door Entry</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'front\\')">Front View</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'top\\')">2D Blueprint</button>' +
            '<button class="pill-btn" onclick="zoomCam(0.12)">+</button>' +
            '<button class="pill-btn" onclick="zoomCam(-0.12)">−</button>' +
          '</div>' +
        '</div>' +
        '<div id="roomScene" class="scene-3d" style="min-height:520px">' +
          '<div id="roomWorld3D" class="room-world">' +
            '<div class="room-slab-front"></div>' +
            '<div class="room-slab-left"></div>' +
            '<div class="room-slab-right"></div>' +
            '<div class="room-wall-front">' + frontWallHtml + '</div>' +
            '<div class="room-wall-left">' + leftWallHtml + '</div>' +
            '<div class="room-wall-right">' + rightWallHtml + '</div>' +
            floorExtrasHtml +
            '<div class="front-corridor-hint">← FRONT WALKWAY →</div>' +
            '<svg id="roomPathSvg" class="room-path-svg"></svg>' +
            '<div id="roomColsWrap" class="room-cols">' + colsHtml + '</div>' +
          '</div>' +
          '<div class="room-legend">' +
            '<span><i class="leg-dot" style="background:#10b981"></i>Your Desk</span>' +
            '<span><i class="leg-dot" style="background:#f5e6ca;border:1px solid #c9a673"></i>Other Desks</span>' +
            '<span><i class="leg-dot" style="background:#f59e0b"></i>Entry Door</span>' +
          '</div>' +
          '<div class="drag-tip">👆 Drag to orbit 3D room · Green aisle path = Door → Seat #' + esc(s.seat_no) + '</div>' +
        '</div>' +
      '</div>';
    }

    function render() {
      const st = DATA.student, ex = DATA.exam, s = DATA.seat;
      const examLine = [ex.session_name, ex.circular_name, ex.schedule_name].filter(Boolean).join(' · ');
      const dateLine = [ex.exam_date ? '📅 ' + ex.exam_date : '', ex.exam_time ? '🕒 ' + ex.exam_time : ''].filter(Boolean).join('   ');

      let body = '';
      if (!s.assigned) {
        body = '<div class="panel" style="text-align:center;padding:34px 20px"><h3 style="color:#fbbf24;margin-bottom:6px">Seat Not Assigned Yet</h3><p style="color:#94a3b8;font-size:13px">Your application is confirmed, and your exam room &amp; seat number will appear here as soon as the seat plan is published.</p></div>';
      } else {
        body =
          '<div class="tabs">' +
            '<button class="tab-btn' + (TAB === 'way' ? ' active' : '') + '" onclick="setTab(\\'way\\')">🧭 3D Way to Exam Hall</button>' +
            '<button class="tab-btn' + (TAB === 'room' ? ' active' : '') + '" onclick="setTab(\\'room\\')">🪑 3D Classroom &amp; My Seat</button>' +
          '</div>' +
          (TAB === 'way' ? renderCampusHtml() : renderRoom3dHtml());
      }

      document.getElementById('appRoot').innerHTML =
        '<div class="hero">' +
          '<div class="hero-top">' +
            '<div>' +
              '<div class="college">Chattogram Cantonment Public College · ' + esc(examLine) + '</div>' +
              '<div class="sname">' + esc(st.name) + '</div>' +
              '<div class="smeta">' + esc([st.class, st.version, st.category].filter(Boolean).join(' · ')) + (st.index_id ? ' &nbsp;|&nbsp; Index: <b>' + esc(st.index_id) + '</b>' : '') + (st.tracking_id ? ' &nbsp;|&nbsp; ID: ' + esc(st.tracking_id) : '') + '</div>' +
              (dateLine ? '<div class="smeta" style="margin-top:4px;color:#fde68a">' + esc(dateLine) + '</div>' : '') +
            '</div>' +
          '</div>' +
          (s.assigned ? (
            '<div class="seat-badges">' +
              '<div class="sbadge"><div class="k">Building &amp; Floor</div><div class="v">' + esc(s.building) + '</div><div style="font-size:11px;color:#cbd5e1;font-weight:700">' + esc(s.floor_label) + '</div></div>' +
              '<div class="sbadge"><div class="k">Exam Room</div><div class="v">Room ' + esc(s.room_name) + '</div><div style="font-size:11px;color:#cbd5e1;font-weight:700">' + esc(s.total_desks) + ' seats in hall</div></div>' +
              '<div class="sbadge hi"><div class="k">Your Exact Seat</div><div class="v">Seat #' + esc(s.seat_no) + '</div><div style="font-size:11px;color:#d1fae5;font-weight:700">' + esc([s.col_label, s.row_number ? 'Row ' + s.row_number : ''].filter(Boolean).join(' · ')) + '</div></div>' +
            '</div>'
          ) : '') +
        '</div>' +
        body;

      applyTransform();
      if (TAB === 'way') wireDrag('campusScene', false);
      else { wireDrag('roomScene', true); setTimeout(drawRoomPath, 60); }
    }

    load();
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
