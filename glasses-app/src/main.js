/**
 * Acting Intern — Even Realities G2 Clinical HUD
 *
 * Companion app for the Acting Intern EHR AI assistant.
 * Runs in the Even Realities phone app WebView and displays
 * clinical data on the G2 smart glasses via the SDK bridge.
 *
 * Architecture:
 * - Polls actingintern.com/api/glasses-state (or localStorage bridge)
 *   for the latest AI state (glassesDisplay, problemList, etc.)
 * - Renders clinical HUD using G2 text containers (576×288 per eye)
 * - Handles touchpad input for navigation between screens
 * - Mic capture for voice dictation relay
 *
 * Display layout:
 * - Left eye: Patient context (scrollable text — summary, problems, alerts)
 * - Right eye: Orders & actions (scrollable text — pending orders, comms)
 *
 * Navigation:
 * - Press: cycle through screens (patient → problems → alerts → orders)
 * - Double press: refresh data from Acting Intern
 * - Swipe up/down: scroll within current screen
 */

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

// ── Config ──
const ACTING_INTERN_URL = 'https://actingintern.com';
const POLL_INTERVAL_MS = 10000; // Poll for updates every 10s
const MAX_CHARS = 1800; // Leave headroom under 2000 limit

// ── State ──
let bridge = null;
let currentScreen = 0; // 0=patient, 1=problems, 2=alerts, 3=orders
let screens = []; // Array of { title, content } for each screen
let pollTimer = null;
let isRecordingAudio = false;

// ── Screens ──
const SCREEN_NAMES = ['PATIENT', 'PROBLEMS', 'ALERTS', 'ORDERS'];

// ── Initialize ──
async function init() {
  try {
    bridge = await waitForEvenAppBridge();
    console.log('🏥 Acting Intern HUD: Bridge connected');

    // Build initial screens with loading message
    screens = SCREEN_NAMES.map(name => ({
      title: name,
      content: `── ${name} ──\n\nConnecting to Acting Intern...`
    }));

    // Create initial page with left + right eye containers
    await createPage();

    // Set up event handling
    bridge.onEvenHubEvent(handleEvent);

    // Fetch initial data
    await refreshData();

    // Start polling for updates
    pollTimer = setInterval(refreshData, POLL_INTERVAL_MS);

    console.log('🏥 HUD initialized — polling every', POLL_INTERVAL_MS / 1000, 's');
  } catch (err) {
    console.error('🏥 HUD init failed:', err);
    // If no bridge (running outside Even Realities app), show fallback
    document.body.innerHTML = `
      <div style="font-family: monospace; padding: 20px; color: #0f0; background: #000;">
        <h2>Acting Intern G2 HUD</h2>
        <p>This app runs inside the Even Realities app on your phone.</p>
        <p>Scan the QR code from <code>evenhub dev</code> to sideload.</p>
        <p>Error: ${err.message}</p>
      </div>
    `;
  }
}

// ── Create the glasses page layout ──
async function createPage() {
  // Left eye: patient context (scrollable text)
  const leftContainer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    paddingLength: 8,
    containerID: 1,
    containerName: 'left_eye',
    content: screens[currentScreen]?.content || 'Loading...',
    isEventCapture: 1, // This container receives all input events
  });

  // Right eye: orders & actions
  const rightContainer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    paddingLength: 8,
    containerID: 2,
    containerName: 'right_eye',
    content: screens[3]?.content || 'No orders yet.',
    isEventCapture: 0,
  });

  const result = await bridge.createStartUpPageContainer(
    [leftContainer],  // Left eye containers
    [rightContainer]   // Right eye containers
  );

  console.log('🏥 Page created, result:', result);
}

// ── Update display without full rebuild ──
async function updateDisplay() {
  if (!bridge) return;

  // Update left eye with current screen
  const leftContent = screens[currentScreen]?.content || '';
  try {
    await bridge.textContainerUpgrade(1, 'left_eye', leftContent, 0, leftContent.length);
  } catch (e) {
    console.warn('Left eye update failed, rebuilding page');
    await rebuildPage();
    return;
  }

  // Right eye always shows orders (screen index 3)
  const rightContent = screens[3]?.content || 'No active orders.';
  try {
    await bridge.textContainerUpgrade(2, 'right_eye', rightContent, 0, rightContent.length);
  } catch (e) {
    console.warn('Right eye update failed');
  }
}

// ── Full page rebuild (when layout changes) ──
async function rebuildPage() {
  if (!bridge) return;

  const leftContainer = new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 1, containerName: 'left_eye',
    content: screens[currentScreen]?.content || '',
    isEventCapture: 1,
  });

  const rightContainer = new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 2, containerName: 'right_eye',
    content: screens[3]?.content || 'No active orders.',
    isEventCapture: 0,
  });

  await bridge.rebuildPageContainer([leftContainer], [rightContainer]);
}

// ── Handle input events ──
function handleEvent(event) {
  const textEvent = event.textEvent;
  if (!textEvent) return;

  const eventType = textEvent.eventType;

  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined: // SDK normalizes 0 to undefined
      // Press: cycle through left-eye screens
      currentScreen = (currentScreen + 1) % 3; // 0, 1, 2 (patient, problems, alerts)
      console.log('🏥 Screen:', SCREEN_NAMES[currentScreen]);
      updateDisplay();
      break;

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Double press: refresh data
      console.log('🏥 Refreshing data...');
      refreshData();
      break;

    case OsEventTypeList.SCROLL_TOP_EVENT:
      // Swipe up: previous screen
      currentScreen = (currentScreen - 1 + 3) % 3;
      console.log('🏥 Screen:', SCREEN_NAMES[currentScreen]);
      updateDisplay();
      break;

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      // Swipe down: toggle mic for dictation
      toggleMic();
      break;
  }
}

// ── Toggle microphone for voice dictation ──
async function toggleMic() {
  if (!bridge) return;

  isRecordingAudio = !isRecordingAudio;
  await bridge.audioControl(isRecordingAudio);

  if (isRecordingAudio) {
    console.log('🏥 Mic ON — recording dictation');
    // Show recording indicator on right eye
    const indicator = '━━━ 🎙 RECORDING ━━━\n\nSpeak your clinical thinking...\n\nSwipe down to stop.';
    await bridge.textContainerUpgrade(2, 'right_eye', indicator, 0, indicator.length);
  } else {
    console.log('🏥 Mic OFF — stopped recording');
    // Restore orders display
    updateDisplay();
  }

  // Audio data arrives via event callback
  bridge.onEvenHubEvent(event => {
    if (event.sysEvent?.audioData) {
      // PCM 16kHz mono — relay to Acting Intern for STT
      // TODO: Send audio chunks to Acting Intern's speech service
      console.log('🏥 Audio chunk received, length:', event.sysEvent.audioData.length);
    }
  });
}

// ── Fetch clinical data from Acting Intern ──
async function refreshData() {
  try {
    // Try fetching from the Acting Intern glasses API
    const response = await fetch(`${ACTING_INTERN_URL}/api/glasses-state`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    }).catch(() => null);

    let data = null;

    if (response?.ok) {
      data = await response.json();
    } else {
      // Fallback: try localStorage bridge (for same-origin testing)
      const stored = localStorage.getItem('glasses-hud-data');
      if (stored) {
        data = JSON.parse(stored);
      }
    }

    if (data) {
      buildScreensFromData(data);
      updateDisplay();
    }
  } catch (err) {
    console.warn('🏥 Data refresh failed:', err.message);
  }
}

// ── Build screen content from clinical data ──
function buildScreensFromData(data) {
  // Screen 0: PATIENT — clinical summary
  let patientContent = '── PATIENT ──\n';
  if (data.oneLiner) {
    patientContent += '\n' + data.oneLiner + '\n';
  }
  if (data.clinicalSummary) {
    const cs = data.clinicalSummary;
    if (cs.demographics) patientContent += '\nID: ' + truncate(cs.demographics, 200);
    if (cs.functional) patientContent += '\nFx: ' + truncate(cs.functional, 200);
    if (cs.presentation) patientContent += '\nNow: ' + truncate(cs.presentation, 200);
  }
  // If using glassesDisplay format
  if (data.glassesDisplay?.leftLens?.[0]) {
    const ps = data.glassesDisplay.leftLens[0];
    patientContent = '── ' + (ps.title || 'PATIENT') + ' ──\n';
    patientContent += (ps.lines || []).join('\n');
  }
  screens[0] = { title: 'PATIENT', content: truncate(patientContent, MAX_CHARS) };

  // Screen 1: PROBLEMS — problem list
  let problemContent = '── PROBLEMS ──\n';
  if (data.problemList?.length) {
    data.problemList.forEach((p, i) => {
      const urgencyMark = p.urgency === 'urgent' ? '! ' : p.urgency === 'active' ? '  ' : '~ ';
      problemContent += `\n${urgencyMark}${i + 1}. ${p.name}`;
      if (p.plan) problemContent += `\n   Plan: ${truncate(p.plan, 100)}`;
    });
  }
  if (data.glassesDisplay?.leftLens?.[1]) {
    const ps = data.glassesDisplay.leftLens[1];
    problemContent = '── ' + (ps.title || 'PROBLEMS') + ' ──\n';
    problemContent += (ps.lines || []).join('\n');
  }
  screens[1] = { title: 'PROBLEMS', content: truncate(problemContent, MAX_CHARS) };

  // Screen 2: ALERTS — safety concerns
  let alertContent = '── ALERTS ──\n';
  if (data.keyConsiderations?.length) {
    data.keyConsiderations.forEach(kc => {
      const icon = kc.severity === 'critical' ? '⚠ ' : kc.severity === 'important' ? '● ' : '○ ';
      alertContent += `\n${icon}${kc.text}`;
    });
  } else {
    alertContent += '\nNo active alerts.';
  }
  if (data.glassesDisplay?.leftLens?.[2]) {
    const ps = data.glassesDisplay.leftLens[2];
    alertContent = '── ' + (ps.title || 'ALERTS') + ' ──\n';
    alertContent += (ps.lines || []).join('\n');
  }
  screens[2] = { title: 'ALERTS', content: truncate(alertContent, MAX_CHARS) };

  // Screen 3: ORDERS — suggested actions (always on right eye)
  let orderContent = '── ORDERS ──\n';
  if (data.categorizedActions) {
    const cats = data.categorizedActions;
    if (cats.labs?.length) {
      orderContent += '\nLABS:';
      cats.labs.forEach(a => { orderContent += '\n  ▶ ' + (a.text || a); });
    }
    if (cats.imaging?.length) {
      orderContent += '\nIMAGING:';
      cats.imaging.forEach(a => { orderContent += '\n  ▶ ' + (a.text || a); });
    }
    if (cats.medications?.length) {
      orderContent += '\nMEDS:';
      cats.medications.forEach(a => { orderContent += '\n  ▶ ' + (a.text || a); });
    }
    if (cats.communication?.length) {
      orderContent += '\nCOMMS:';
      cats.communication.forEach(a => { orderContent += '\n  ▶ ' + (a.text || a); });
    }
    if (cats.other?.length) {
      orderContent += '\nOTHER:';
      cats.other.forEach(a => { orderContent += '\n  ▶ ' + (a.text || a); });
    }
  }
  if (data.glassesDisplay?.rightLens) {
    orderContent = '';
    data.glassesDisplay.rightLens.forEach(rs => {
      orderContent += '── ' + (rs.title || 'ORDERS') + ' ──\n';
      orderContent += (rs.lines || []).join('\n') + '\n\n';
    });
  }
  screens[3] = { title: 'ORDERS', content: truncate(orderContent, MAX_CHARS) };

  console.log('🏥 Screens updated:', screens.map(s => s.title + '(' + s.content.length + ')').join(', '));
}

// ── Utility ──
function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
}

// ── Start ──
init();
