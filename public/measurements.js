const gpsCaptures = new Map();
const gpsRequests = new Map();
let gpsCheckShotId = null;

function measurementMode() {
  return currentEvent?.measurementMode || 'angles';
}

function modeName(mode) {
  return { gps: 'GPS locations', bearings: 'Compass bearings', angles: 'Legacy angles' }[mode];
}

function gpsFields(prefix, name) {
  return `<fieldset class="gps-fields">
    <legend>${name}</legend>
    <div class="row">
      <div class="field"><label for="${prefix}Lat">${name} latitude</label><input id="${prefix}Lat" type="number" inputmode="decimal" min="-90" max="90" step="any"></div>
      <div class="field"><label for="${prefix}Lng">${name} longitude</label><input id="${prefix}Lng" type="number" inputmode="decimal" min="-180" max="180" step="any"></div>
    </div>
    <button type="button" class="secondary measurement-block" onclick="captureGps('${prefix}')">Capture GPS at ${name.toLowerCase()}</button>
    <p class="tiny" id="${prefix}Status" role="status">Enter coordinates manually, or capture this device's location while standing at the marked point. Capture does not save a measurement.</p>
  </fieldset>`;
}

for (const [container, prefix, name] of [
  ['trebGpsFields', 'launch', 'Launch location'],
  ['landingGpsFields', 'landing', 'Landing location'],
  ['checkLaunchGpsFields', 'checkLaunch', 'Check launch location'],
  ['checkLandingGpsFields', 'checkLanding', 'Check landing location']
]) {
  document.getElementById(container).innerHTML = gpsFields(prefix, name);
  for (const axis of ['Lat', 'Lng']) {
    document.getElementById(prefix + axis).addEventListener('input', () => {
      gpsCaptures.delete(prefix);
      gpsRequests.delete(prefix);
      document.getElementById(prefix + 'Status').textContent = 'Manual coordinates. Reported GPS accuracy and capture time are unknown.';
    });
  }
}

function updateNewEventMode() {
  const mode = document.getElementById('newEventMode').value;
  document.getElementById('newBaselineField').hidden = mode === 'gps';
  document.getElementById('newModeDescription').textContent = {
    gps: 'Record launch GPS for each trebuchet, then landing GPS for each shot. No observation stations or baseline needed.',
    bearings: 'Set up two fixed stations once. For each shot, spotters report one compass bearing each. GPS checks are optional.',
    angles: 'Existing workflow: enter angles relative to the baseline. Compass conversion is not applied.'
  }[mode];
}

function gpsQuality(position) {
  if (!position) return 'GPS not recorded';
  return position.accuracy == null ? 'Reported GPS accuracy unknown'
    : `Reported GPS accuracy: ±${Math.round(position.accuracy)} m`;
}

function readGpsFields(prefix, required = true) {
  const latitude = $(prefix + 'Lat').value;
  const longitude = $(prefix + 'Lng').value;
  if (!required && latitude === '' && longitude === '') return null;
  const saved = gpsCaptures.get(prefix);
  const samePosition = saved && latitude === saved.latitude && longitude === saved.longitude;
  return { latitude, longitude, accuracy: samePosition ? saved.accuracy : null, capturedAt: samePosition ? saved.capturedAt : null };
}

function setGpsFields(prefix, position) {
  gpsCaptures.delete(prefix);
  gpsRequests.delete(prefix);
  $(prefix + 'Lat').value = position?.latitude ?? '';
  $(prefix + 'Lng').value = position?.longitude ?? '';
  if (position) {
    gpsCaptures.set(prefix, {
      ...position, latitude: $(prefix + 'Lat').value, longitude: $(prefix + 'Lng').value
    });
  }
  $(prefix + 'Status').textContent = position
    ? `${gpsQuality(position)}.${position.capturedAt ? ` Captured ${new Date(position.capturedAt).toLocaleString()}.` : ' Capture time unknown.'} Review before saving.`
    : "Enter coordinates manually, or capture this device's location while standing at the marked point. Capture does not save a measurement.";
}

function captureGps(prefix) {
  if (!requireEditing()) return;
  const status = $(prefix + 'Status');
  if (!navigator.geolocation) {
    status.textContent = 'GPS is unavailable in this browser. Enter coordinates manually.';
    return;
  }
  const eventId = currentEventId;
  const checkId = gpsCheckShotId;
  const request = {};
  gpsRequests.set(prefix, request);
  status.textContent = 'Capturing this device’s position. Stay at the marked location...';
  navigator.geolocation.getCurrentPosition(position => {
    if (eventId !== currentEventId || gpsRequests.get(prefix) !== request ||
      prefix.startsWith('check') && checkId !== gpsCheckShotId || !editable || spectator) return;
    setGpsFields(prefix, {
      latitude: position.coords.latitude, longitude: position.coords.longitude,
      accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString()
    });
  }, error => {
    if (eventId !== currentEventId || gpsRequests.get(prefix) !== request) return;
    status.textContent = `GPS capture failed: ${error.message}. Check location permission and HTTPS, or enter coordinates manually.`;
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

function resetMeasurementDrafts() {
  gpsCaptures.clear();
  gpsRequests.clear();
  closeGpsCheck();
  for (const prefix of ['launch', 'landing']) setGpsFields(prefix, null);
  for (const id of ['bearingA', 'bearingB', 'trebBearing']) $(id).value = '';
}

function renderMeasurementMode() {
  const mode = measurementMode();
  document.documentElement.dataset.measurement = mode;
  document.documentElement.dataset.gpsBackup = String(Boolean(setup?.gpsBackup));
  $('referenceA').value = setup?.referenceA ?? '';
  $('referenceB').value = setup?.referenceB ?? '';
  $('gpsBackup').checked = Boolean(setup?.gpsBackup);
  $('unit').disabled = mode !== 'angles' && Boolean(trebs.length || shots.length);
  $('unit').title = $('unit').disabled ? 'Units are fixed once trebuchets or shots are recorded.' : '';
  $('shotEntryHeading').textContent = mode === 'gps' ? 'Log a GPS shot' : mode === 'bearings' ? 'Log a compass shot' : 'Log a shot';
  $('trebGpsFields').querySelector('legend').textContent = mode === 'bearings' ? 'Launch GPS (optional, for checks)' : 'Launch location';
  const difference = setup?.referenceA != null && setup?.referenceB != null
    ? Math.abs(((setup.referenceA - setup.referenceB + 540) % 360) - 180) : 180;
  $('referenceWarning').textContent = mode === 'bearings' && difference < 175
    ? 'Reference readings should be approximately opposite. Recheck away from magnetic interference; agreement does not prove accuracy.' : '';
  $('trebInstructions').textContent = {
    gps: 'Record the launch GPS position for each trebuchet. No observation stations, baseline, or compass readings are needed.',
    bearings: 'One-time survey: measure the distance from Station A to the trebuchet, then sight it from A and enter the forward compass bearing. Use the same compass as the A→B reference.',
    angles: 'For each trebuchet, measure its distance from Station A and its angle from the A→B baseline. Positive angles sweep counter-clockwise from A→B; negative angles sweep clockwise.'
  }[mode];
  $('trebColumn2').textContent = mode === 'gps' ? 'Latitude' : 'Dist. from A';
  $('trebColumn3').textContent = mode === 'gps' ? 'Longitude' : mode === 'bearings' ? 'Bearing' : 'Angle';
  $('shotColumnA').textContent = mode === 'gps' ? 'Landing latitude' : mode === 'bearings' ? 'A bearing' : '∠A';
  $('shotColumnB').textContent = mode === 'gps' ? 'Landing longitude' : mode === 'bearings' ? 'B bearing' : '∠B';
  $('shotCheckColumn').textContent = mode === 'gps' ? 'GPS quality' : 'Baseline check';
  if (mode === 'gps' && currentVisualizerView !== 'map') switchVisualizerView('map');
  renderMeasurementSummary();
}

function renderMeasurementSummary() {
  if (!currentEvent) return;
  const mode = measurementMode();
  if (mode === 'angles') {
    $('measurementChecklist').innerHTML = '';
    return;
  }
  const ready = mode === 'gps' ? trebs.filter(t => t.gps).length : trebs.length;
  $('unit').disabled = Boolean(trebs.length || shots.length);
  $('unit').title = $('unit').disabled ? 'Units are fixed once trebuchets or shots are recorded.' : '';
  $('eventSummarySetup').textContent = mode === 'gps'
    ? `GPS event · ${ready} launch location${ready === 1 ? '' : 's'} recorded · distances in ${currentEvent.unit}. No stations required.`
    : `Compass event · ${setup?.baseline ? `Baseline ${setup.baseline} ${setup.unit}` : 'Baseline needed'} · ${setup?.referenceA != null && setup?.referenceB != null ? 'Station references saved' : 'Station references needed'} · ${ready} trebuchet survey${ready === 1 ? '' : 's'} · GPS checks ${setup?.gpsBackup ? 'enabled' : 'off'}.`;
  const stationsReady = setup?.baseline > 0 && setup?.referenceA != null && setup?.referenceB != null;
  $('measurementChecklist').innerHTML = `<ol class="measurement-checklist">
    ${mode === 'bearings' ? `<li><a href="#setupCard" onclick="event.preventDefault();openEventSection('setup','setupCard')">Set up stations</a><br><span class="tiny">${stationsReady ? 'Baseline and reference bearings saved.' : 'Measure the baseline and record both reference bearings once.'}</span></li>` : ''}
    <li><a href="#trebCard" onclick="event.preventDefault();openEventSection('setup','trebCard')">${mode === 'gps' ? 'Record launch locations' : 'Survey trebuchets'}</a><br><span class="tiny">${ready ? `${ready} ready for ${mode === 'gps' ? 'GPS' : 'bearing'} measurements.` : mode === 'gps' ? 'Capture or enter GPS at each launch point.' : 'Enter each distance and bearing from Station A.'}</span></li>
    <li><a href="#shotEntryCard" onclick="event.preventDefault();openEventSection('shot','shotEntryCard')">Log a shot</a><br><span class="tiny">${mode === 'gps' ? 'Select a trebuchet and record landing GPS during a safe recovery period.' : 'Select a trebuchet and enter the two impact bearings.'}</span></li>
  </ol>`;
}

function openGpsCheck(id) {
  if (!requireEditing()) return;
  const shot = shots.find(item => item.id === id);
  if (!shot) return showInlineError('This shot is no longer available. Refresh the event.');
  gpsCheckShotId = id;
  $('gpsCheckHeading').textContent = `GPS check: ${shot.label}`;
  setGpsFields('checkLaunch', shot.launchGps || null);
  setGpsFields('checkLanding', null);
  switchEventTab('history');
  $('gpsCheckPanel').hidden = false;
  $('gpsCheckPanel').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function closeGpsCheck() {
  gpsCheckShotId = null;
  gpsRequests.delete('checkLaunch');
  gpsRequests.delete('checkLanding');
  document.getElementById('gpsCheckPanel').hidden = true;
}

async function saveGpsCheck() {
  if (!requireEditing() || gpsCheckShotId == null) return;
  const eventId = currentEventId;
  const shotId = gpsCheckShotId;
  try {
    const response = await eventFetch(`/api/events/${encodeURIComponent(eventId)}/shots/${shotId}/gps-checks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launchGps: readGpsFields('checkLaunch'), landingGps: readGpsFields('checkLanding') })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (eventId !== currentEventId) return;
    shots = shots.map(shot => shot.id === shotId ? data : shot);
    if (gpsCheckShotId === shotId) closeGpsCheck();
    clearInlineError();
    renderTable();
  } catch (error) {
    if (eventId === currentEventId) showInlineError(`Cannot save GPS check: ${error.message}`);
  }
}

function shotReadingSummary(shot) {
  return shot.method === 'gps'
    ? `GPS · ${gpsQuality(shot.launchGps)} (launch); ${gpsQuality(shot.landingGps)} (landing)`
    : shot.method === 'bearings' ? `Bearings A ${shot.bearingA}° · B ${shot.bearingB}°`
    : `A ${shot.angA}° · B ${shot.angB}°`;
}

function gpsCheckMarkup(shot) {
  return (shot.gpsChecks || []).map(check => `<div class="tiny gps-check-result">GPS check: ${check.dist.toFixed(1)} ${check.unit} · difference ${Math.abs(check.dist - shot.dist).toFixed(1)} ${check.unit}<br>${gpsQuality(check.launchGps)} (launch); ${gpsQuality(check.landingGps)} (landing)</div>`).join('');
}

function renderGpsMap() {
  $('mapNotice').textContent = 'GPS positions: distances use saved launch and landing coordinates, not satellite image pixels. Reported GPS accuracy is an estimate, not a guaranteed error bound.';
  const bounds = L.latLngBounds();
  for (const trebuchet of trebs) {
    if (!trebuchet.gps) continue;
    const position = [trebuchet.gps.latitude, trebuchet.gps.longitude];
    bounds.extend(position);
    mapLayerGroup.addLayer(createMapMarker(position, 'trebuchet', trebuchet.name,
      `<b>${escapeHtml(trebuchet.name)}</b><br>${gpsQuality(trebuchet.gps)}`, '', trebColor(trebuchet)));
  }
  for (const shot of shots) {
    const launch = [shot.launchGps.latitude, shot.launchGps.longitude];
    const landing = [shot.landingGps.latitude, shot.landingGps.longitude];
    bounds.extend(launch);
    bounds.extend(landing);
    const active = shot.id === activeShot()?.id;
    mapLayerGroup.addLayer(createMapMarker(landing, 'impact', shot.label,
      `<b>${escapeHtml(shot.label)}</b><br>${shot.dist.toFixed(1)} ${shot.unit}<br>${gpsQuality(shot.landingGps)}`, '', trebColor(shot), active ? 1 : .55));
    mapLayerGroup.addLayer(L.polyline([launch, landing], {
      color: trebColor(shot), weight: active ? 3 : 1, opacity: active ? .95 : .25
    }));
  }
  if (bounds.isValid()) leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  else {
    $('mapNotice').textContent = 'Add a trebuchet launch GPS location to start plotting this GPS event. No station coordinates are needed.';
    leafletMap.setView([39, -98], 4);
  }
}
