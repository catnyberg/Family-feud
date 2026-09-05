/* Family Feud — Friends Edition
 * Plain ES2017, no dependencies, no build step. Everything lives in one `state`
 * object; every mutation calls save() then render().
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'familyFeudFriendsEdition.v1';

  /* ------------------------------------------------------------------ state */

  var defaults = null;   // pristine deck data, loaded from questions.json
  var state = null;
  var justRevealed = -1; // cell index to animate on the next render, then cleared

  function blankRoundState() {
    return { revealed: {}, ticks: {}, strikes: 0, pot: 0, awarded: 0, glitched: false };
  }

  function freshState(data) {
    return {
      data: clone(data),
      roundIndex: 0,
      rounds: {},              // roundIndex -> blankRoundState()
      scores: [0, 0],
      teamNames: ['Team A', 'Team B'],
      muted: false,
      notesOpen: false,
      bonus: { revealed: {}, hostRevealed: false, outcome: null }
    };
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function roundState(i) {
    var key = String(i == null ? state.roundIndex : i);
    if (!state.rounds[key]) state.rounds[key] = blankRoundState();
    return state.rounds[key];
  }

  function currentRound() { return state.data.rounds[state.roundIndex]; }

  function bonusRound() { return state.data.bonusRound || null; }

  /** The bonus round sits one past the last normal round. */
  function bonusIndex() { return bonusRound() ? state.data.rounds.length : -1; }
  function onBonus() { return state.roundIndex === bonusIndex(); }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* private browsing / storage disabled — the game still works in-memory */
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.data || !Array.isArray(parsed.data.rounds)) return null;
      // Fill in anything a older/partial save is missing.
      var base = freshState(parsed.data);
      Object.keys(base).forEach(function (k) {
        if (parsed[k] === undefined) parsed[k] = base[k];
      });
      return parsed;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ audio */

  var audioCtx = null;

  function ctx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, start, duration, type, peak) {
    var ac = ctx();
    if (!ac) return;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ac.currentTime + start);
    gain.gain.setValueAtTime(0.0001, ac.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(peak || 0.25, ac.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + duration + 0.05);
  }

  function noise(duration, peak) {
    var ac = ctx();
    if (!ac) return;
    var frames = Math.floor(ac.sampleRate * duration);
    var buffer = ac.createBuffer(1, frames, ac.sampleRate);
    var chan = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) chan[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    var src = ac.createBufferSource();
    var gain = ac.createGain();
    gain.gain.value = peak || 0.18;
    src.buffer = buffer;
    src.connect(gain).connect(ac.destination);
    src.start();
  }

  var sfx = {
    reveal: function () { tone(880, 0, 0.16, 'triangle'); tone(1320, 0.08, 0.22, 'triangle', 0.2); },
    strike: function () { tone(160, 0, 0.45, 'sawtooth', 0.3); tone(110, 0.05, 0.5, 'square', 0.22); },
    award:  function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.08, 0.25, 'triangle', 0.22); }); },
    glitch: function () { noise(0.55, 0.22); tone(70, 0.05, 0.4, 'square', 0.18); tone(1900, 0.2, 0.12, 'square', 0.1); }
  };

  function play(name) {
    if (state.muted) return;
    try { sfx[name](); } catch (e) { /* audio unavailable — never block the game */ }
  }

  /* --------------------------------------------------------------- elements */

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['app', 'brandTitle', 'brandSub', 'prevRound', 'nextRound', 'roundSelect', 'muteBtn', 'helpBtn',
   'editBtn', 'questionBanner', 'questionText', 'surveySays', 'surveyNote', 'board', 'potValue', 'strikeDisplay',
   'strikeBtn', 'clearStrikes', 'awardA', 'awardB', 'glitchBtn', 'freeGuessBtn', 'notesBtn',
   'resetRound', 'resetGame', 'notesDrawer', 'teamAName', 'teamBName', 'teamAScore', 'teamBScore',
   'strikeFlash', 'freeGuessModal', 'freeGuessBody', 'helpModal', 'editModal', 'editBody',
   'addRound', 'exportBtn', 'importBtn', 'restoreBtn', 'importFile',
   'bonusPanel', 'clueGrid', 'bonusReveal', 'payout', 'revealHost', 'bonusWin', 'bonusLose',
   'bonusSplit', 'bonusClear', 'potRow'
  ].forEach(function (id) { el[id] = $(id); });

  /* --------------------------------------------------------------- scoring */

  function answerValue(answer, rs, index) {
    if (answer.type === 'list') {
      var ticked = (rs.ticks[index] || []).length;
      return ticked * (answer.pointsPerItem || 1);
    }
    return Number(answer.points) || 0;
  }

  /** The pot is whatever is revealed/ticked minus what has already been banked,
   *  so awarding never has to blank the board. */
  function recomputePot() {
    var round = currentRound();
    if (!round) return;                          // bonus round has no pot
    var rs = roundState();
    var total = 0;
    round.answers.forEach(function (a, i) {
      if (a.type === 'list') {
        total += answerValue(a, rs, i);          // ticks stand in for reveal
      } else if (rs.revealed[i]) {
        total += answerValue(a, rs, i);
      }
    });
    rs.pot = Math.max(0, total - (rs.awarded || 0));
  }

  /* --------------------------------------------------------------- actions */

  function toggleReveal(i) {
    var rs = roundState();
    var answer = currentRound().answers[i];
    if (!answer) return;
    // For a checklist slot this expands/collapses the list; for a normal answer
    // it flips the cell. Either way the pot is re-derived below.
    rs.revealed[i] = !rs.revealed[i];
    if (rs.revealed[i]) { play('reveal'); justRevealed = i; }
    recomputePot();
    save();
    render();
  }

  function toggleTick(answerIndex, itemIndex) {
    var rs = roundState();
    var list = rs.ticks[answerIndex] || (rs.ticks[answerIndex] = []);
    var at = list.indexOf(itemIndex);
    if (at === -1) { list.push(itemIndex); play('reveal'); }
    else { list.splice(at, 1); }
    recomputePot();
    save();
    render();
  }

  function addStrike() {
    var rs = roundState();
    if (rs.strikes < 3) rs.strikes++;
    play('strike');
    flashStrike();
    save();
    render();
  }

  function flashStrike() {
    el.strikeFlash.classList.remove('show');
    void el.strikeFlash.offsetWidth;             // restart the animation
    el.strikeFlash.classList.add('show');
    setTimeout(function () { el.strikeFlash.classList.remove('show'); }, 800);
  }

  function awardPot(team) {
    var rs = roundState();
    if (rs.pot === 0) return;
    state.scores[team] += rs.pot;
    // Remember what was banked so the same points can't be awarded twice,
    // while the revealed board stays on screen.
    rs.awarded = (rs.awarded || 0) + rs.pot;
    rs.pot = 0;
    play('award');
    save();
    render();
  }

  function adjustScore(team, delta) {
    state.scores[team] += delta;
    save();
    render();
  }

  function goToRound(i) {
    var n = state.data.rounds.length + (bonusRound() ? 1 : 0);
    if (n === 0) return;
    var target = ((i % n) + n) % n;
    // Host notes close on every round change, so they can never carry over onto
    // a projected screen — the host reopens them deliberately per round.
    if (target !== state.roundIndex) state.notesOpen = false;
    state.roundIndex = target;
    save();
    render();
  }

  function resetRound() {
    if (onBonus()) {
      state.bonus = { revealed: {}, hostRevealed: false, outcome: null };
    } else {
      state.rounds[String(state.roundIndex)] = blankRoundState();
    }
    save();
    render();
  }

  function resetGame() {
    if (!window.confirm('Reset the whole game? Scores, strikes and every revealed answer go back to zero. Your questions are kept.')) return;
    var data = state.data;
    var names = state.teamNames;
    var muted = state.muted;
    state = freshState(data);
    state.teamNames = names;
    state.muted = muted;
    save();
    render();
  }

  function toggleGlitch() {
    var round = currentRound();
    if (!round.glitchQuestion) return;
    var rs = roundState();
    play('glitch');
    el.questionBanner.classList.add('glitching');
    setTimeout(function () {
      rs.glitched = !rs.glitched;
      save();
      render();
    }, 420);
    setTimeout(function () {
      el.questionBanner.classList.remove('glitching');
    }, 800);
  }

  /* ----------------------------------------------------------- bonus round */

  function toggleClue(i) {
    var b = state.bonus;
    b.revealed[i] = !b.revealed[i];
    if (b.revealed[i]) play('reveal');
    save();
    render();
  }

  function setBonusOutcome(outcome) {
    state.bonus.outcome = state.bonus.outcome === outcome ? null : outcome;
    if (state.bonus.outcome === 'win') play('award');
    else if (state.bonus.outcome === 'lose') play('strike');
    save();
    render();
  }

  function pts(n) { return n + (Math.abs(n) === 1 ? ' pt' : ' pts'); }

  function payoutFor(kind) {
    var p = (bonusRound() && bonusRound().payout) || {};
    var fallback = { win: 5, lose: 1, split: 3, first: 5, second: 1 };
    return p[kind] === undefined ? fallback[kind] : p[kind];
  }

  function renderBonus() {
    var bonus = bonusRound();
    var b = state.bonus;

    el.surveySays.textContent = bonus.title || 'Bonus Round';
    el.questionText.textContent = bonus.prompt || 'Whose survey answers are these?';
    el.surveyNote.textContent = 'Third-place pair only — all or nothing';

    // Clue cards
    el.clueGrid.innerHTML = '';
    (bonus.clues || []).forEach(function (clue, i) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'clue' + (b.revealed[i] ? ' revealed' : '');
      var q = document.createElement('span');
      q.className = 'clue-q';
      q.textContent = clue.question;
      var a = document.createElement('span');
      a.className = 'clue-a';
      a.textContent = b.revealed[i] ? clue.answer : 'Click to reveal';
      card.appendChild(q);
      card.appendChild(a);
      card.addEventListener('click', function () { toggleClue(i); });
      el.clueGrid.appendChild(card);
    });

    // The answer
    el.bonusReveal.className = 'bonus-reveal' + (b.hostRevealed ? ' shown' : '');
    el.bonusReveal.textContent = b.hostRevealed
      ? 'It was ' + (bonus.hostName || 'The Host') + '.'
      : 'Answer hidden';
    el.revealHost.textContent = b.hostRevealed ? 'Hide the answer' : 'Reveal the answer';
    el.bonusWin.hidden = !b.hostRevealed;
    el.bonusLose.hidden = !b.hostRevealed;
    el.bonusWin.textContent = 'Guessed right — ' + pts(payoutFor('win'));
    el.bonusLose.textContent = 'Guessed wrong — ' + pts(payoutFor('lose'));
    el.bonusSplit.textContent = 'Declined the gamble — ' + pts(payoutFor('split'));
    [['bonusWin', 'win'], ['bonusLose', 'lose'], ['bonusSplit', 'split']].forEach(function (pair) {
      el[pair[0]].classList.toggle('chosen', b.outcome === pair[1]);
    });

    renderPayout();
  }

  /** The end-of-game prize table, derived from the two team scores. */
  function renderPayout() {
    var b = state.bonus;
    var a0 = state.scores[0], a1 = state.scores[1];
    var names = state.teamNames;

    el.payout.innerHTML = '';
    var head = document.createElement('h2');
    head.textContent = 'Final scoring';
    el.payout.appendChild(head);

    var lines = [];
    if (a0 === a1) {
      lines.push(['Dead tie at ' + a0 + ' — break it before paying out.', 'tie']);
    } else {
      var leadIdx = a0 > a1 ? 0 : 1;
      lines.push([names[leadIdx] + ' wins the Feud (' + Math.max(a0, a1) + ' to ' +
        Math.min(a0, a1) + ') — ' + pts(payoutFor('first')) + ' to each pair on that team.', 'win']);
      lines.push([names[1 - leadIdx] + ' — ' + pts(payoutFor('second')) + ' to each pair.', 'lose']);
    }

    var third, thirdClass = b.outcome ? 'settled' : 'pending';
    if (b.outcome === 'win') {
      third = 'Third-place pair gambled and nailed it: ' + pts(payoutFor('win')) + ' each.';
    } else if (b.outcome === 'lose') {
      third = 'Third-place pair gambled and missed: ' + pts(payoutFor('lose')) + ' each.';
      thirdClass = 'missed';
    } else if (b.outcome === 'split') {
      third = 'Third-place pair kept the split: ' + pts(payoutFor('split')) + ' each.';
    } else {
      third = 'Third-place pair: ' + pts(payoutFor('split')) + ' each, or gamble on the bonus for ' +
        payoutFor('win') + ' / ' + payoutFor('lose') + '.';
    }
    lines.push([third, thirdClass]);

    lines.forEach(function (line) {
      var p = document.createElement('p');
      p.className = 'payout-line payout-' + line[1];
      p.textContent = line[0];
      el.payout.appendChild(p);
    });
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    var round = currentRound();

    el.brandTitle.textContent = (state.data.title || 'Family Feud').toUpperCase();
    el.brandSub.textContent = state.data.subtitle || '';

    // Round picker
    el.roundSelect.innerHTML = '';
    state.data.rounds.forEach(function (r, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = 'Round ' + (i + 1) + ' — ' + truncate(r.question, 44);
      el.roundSelect.appendChild(opt);
    });
    if (bonusRound()) {
      var bopt = document.createElement('option');
      bopt.value = String(bonusIndex());
      bopt.textContent = '★ ' + (bonusRound().title || 'Bonus Round') + ' — ' +
        truncate(bonusRound().prompt || '', 34);
      el.roundSelect.appendChild(bopt);
    }
    el.roundSelect.value = String(state.roundIndex);

    // The bonus round replaces the board with its own panel.
    var bonusView = onBonus();
    el.bonusPanel.hidden = !bonusView;
    el.board.hidden = bonusView;
    el.potRow.hidden = bonusView;
    [el.strikeBtn, el.clearStrikes, el.awardA, el.awardB, el.resetRound].forEach(function (b) {
      b.hidden = bonusView;
    });
    if (bonusView) {
      el.glitchBtn.hidden = true;
      el.freeGuessBtn.hidden = true;
      renderBonusNotes();
      renderBonus();
      renderScoreboard();
      return;
    }

    if (!round) {
      el.questionText.textContent = 'No rounds yet — open the editor to add one.';
      el.board.innerHTML = '';
      return;
    }

    var rs = roundState();

    // Question banner
    el.surveySays.textContent = 'Survey says…';
    el.questionText.textContent = (rs.glitched && round.glitchQuestion) ? round.glitchQuestion : round.question;
    el.surveyNote.textContent = state.data.surveyNote || '';
    el.glitchBtn.hidden = !round.glitchQuestion;

    // Board
    el.board.innerHTML = '';
    round.answers.forEach(function (answer, i) {
      el.board.appendChild(buildCell(answer, i, rs));
    });
    justRevealed = -1;

    // Pot + strikes
    el.potValue.textContent = String(rs.pot);
    el.strikeDisplay.innerHTML = '';
    for (var s = 0; s < 3; s++) {
      var x = document.createElement('div');
      x.className = 'x' + (s < rs.strikes ? ' on' : '');
      x.textContent = '✖';
      el.strikeDisplay.appendChild(x);
    }

    // Notes
    var hasNotes = !!(round.notes && round.notes.trim());
    el.notesBtn.hidden = !hasNotes;
    el.notesDrawer.hidden = !(hasNotes && state.notesOpen);
    if (hasNotes) {
      el.notesDrawer.innerHTML = '';
      var label = document.createElement('span');
      label.className = 'notes-label';
      label.textContent = 'Host notes';
      var body = document.createElement('span');
      body.textContent = round.notes;
      el.notesDrawer.appendChild(label);
      el.notesDrawer.appendChild(body);
    }

    // Free-guess panel is available whenever the round has a no-strike list.
    el.freeGuessBtn.hidden = !round.answers.some(function (a) { return a.type === 'list' && a.noStrike; });

    // Awards + scores
    el.awardA.textContent = '← Award pot to ' + state.teamNames[0];
    el.awardB.textContent = 'Award pot to ' + state.teamNames[1] + ' →';
    renderScoreboard();
  }

  function renderScoreboard() {
    if (document.activeElement !== el.teamAName) el.teamAName.value = state.teamNames[0];
    if (document.activeElement !== el.teamBName) el.teamBName.value = state.teamNames[1];
    el.teamAScore.textContent = String(state.scores[0]);
    el.teamBScore.textContent = String(state.scores[1]);

    el.muteBtn.textContent = state.muted ? '🔇' : '🔊';
    el.muteBtn.setAttribute('aria-pressed', String(state.muted));
  }

  function renderBonusNotes() {
    var notes = (bonusRound() || {}).notes;
    var has = !!(notes && notes.trim());
    el.notesBtn.hidden = !has;
    el.notesDrawer.hidden = !(has && state.notesOpen);
    if (!has) return;
    el.notesDrawer.innerHTML = '';
    var label = document.createElement('span');
    label.className = 'notes-label';
    label.textContent = 'Host notes';
    var body = document.createElement('span');
    body.textContent = notes;
    el.notesDrawer.appendChild(label);
    el.notesDrawer.appendChild(body);
  }

  function buildCell(answer, i, rs) {
    var isList = answer.type === 'list';
    var revealed = !!rs.revealed[i];

    var cell = document.createElement(isList ? 'div' : 'button');
    cell.className = 'cell ' + (revealed || (isList && answerValue(answer, rs, i) > 0) ? 'revealed' : 'hidden');
    if (isList) cell.classList.add('list-slot');
    if (i === justRevealed) cell.classList.add('just-revealed');
    if (!isList) cell.type = 'button';

    var header = document.createElement(isList ? 'button' : 'div');
    header.className = isList ? 'cell-header' : 'cell-inner';
    if (isList) header.type = 'button';

    var inner = isList ? document.createElement('div') : header;
    if (isList) {
      inner.className = 'cell-inner';
      header.appendChild(inner);
      header.style.background = 'none';
      header.style.border = 'none';
      header.style.padding = '0';
      header.style.font = 'inherit';
      header.style.color = 'inherit';
    }

    var slot = document.createElement('span');
    slot.className = 'slot';
    slot.textContent = String(i + 1);

    var text = document.createElement('span');
    text.className = 'answer';
    var showText = revealed || (isList && answerValue(answer, rs, i) > 0);
    text.textContent = showText ? answer.text : dots(answer.text);

    var pts = document.createElement('span');
    pts.className = 'points';
    pts.textContent = String(answerValue(answer, rs, i));

    inner.appendChild(slot);
    inner.appendChild(text);
    inner.appendChild(pts);
    cell.appendChild(header);

    (isList ? header : cell).addEventListener('click', function () { toggleReveal(i); });

    if (isList && revealed) {
      cell.appendChild(buildChecklist(answer, i, rs));
    }

    return cell;
  }

  function buildChecklist(answer, answerIndex, rs) {
    var wrap = document.createElement('div');
    wrap.className = 'checklist';

    var note = document.createElement('p');
    note.className = 'checklist-note';
    var per = (answer.pointsPerItem || 1) + (Math.abs(answer.pointsPerItem || 1) === 1 ? ' point' : ' points');
    note.textContent = 'Tick each one a team names — ' + per + ' each' +
      (answer.noStrike ? ', and guessing any of these never costs a strike.' : '.');
    wrap.appendChild(note);

    var ticked = rs.ticks[answerIndex] || [];
    (answer.items || []).forEach(function (item, idx) {
      var isOn = ticked.indexOf(idx) !== -1;
      var label = document.createElement('label');
      label.className = isOn ? 'ticked' : '';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = isOn;
      box.addEventListener('change', function () { toggleTick(answerIndex, idx); });
      var span = document.createElement('span');
      span.textContent = item;
      label.appendChild(box);
      label.appendChild(span);
      wrap.appendChild(label);
    });

    return wrap;
  }

  function dots(text) {
    var n = Math.min(14, Math.max(4, Math.round((text || '').length / 3)));
    return new Array(n + 1).join('•');
  }

  function truncate(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* ------------------------------------------------------------ free guesses */

  function openFreeGuesses() {
    var round = currentRound();
    el.freeGuessBody.innerHTML = '';

    var intro = document.createElement('p');
    intro.style.marginTop = '0';
    intro.textContent = 'Anything on the board or on this list is a free guess — no strike. ' +
      'Only a guess that appears in neither place counts as a strike.';
    el.freeGuessBody.appendChild(intro);

    var boardHead = document.createElement('h3');
    boardHead.textContent = 'On the board';
    el.freeGuessBody.appendChild(boardHead);
    var boardList = document.createElement('ul');
    round.answers.forEach(function (a) {
      if (a.type === 'list') return;
      var li = document.createElement('li');
      li.textContent = a.text + ' (' + (a.points || 0) + ')';
      boardList.appendChild(li);
    });
    el.freeGuessBody.appendChild(boardList);

    round.answers.forEach(function (a, i) {
      if (a.type !== 'list' || !a.noStrike) return;
      var head = document.createElement('h3');
      head.textContent = a.text + ' — ' + (a.pointsPerItem || 1) + ' pt each';
      el.freeGuessBody.appendChild(head);

      var wrap = buildChecklist(a, i, roundState());
      // Ticking from here should also reveal the slot on the board.
      wrap.addEventListener('change', function () {
        roundState().revealed[i] = true;
        save();
        render();
        openFreeGuesses();                       // rebuild so ticks show here too
      });
      el.freeGuessBody.appendChild(wrap);
    });

    show('freeGuessModal');
  }

  /* ----------------------------------------------------------------- editor */

  function renderEditor() {
    el.editBody.innerHTML = '';
    state.data.rounds.forEach(function (round, ri) {
      el.editBody.appendChild(buildRoundEditor(round, ri));
    });
    if (bonusRound()) el.editBody.appendChild(buildBonusEditor());
  }

  function buildBonusEditor() {
    var bonus = bonusRound();
    var box = document.createElement('div');
    box.className = 'edit-round edit-bonus';

    var head = document.createElement('div');
    head.className = 'edit-round-head';
    var title = document.createElement('h3');
    title.textContent = '★ Bonus round';
    head.appendChild(title);
    box.appendChild(head);

    box.appendChild(field('Prompt', 'text', bonus.prompt || '', function (v) {
      bonus.prompt = v; commitEdit(false);
    }));
    box.appendChild(field('Whose answers are they? (the reveal)', 'text', bonus.hostName || '', function (v) {
      bonus.hostName = v; commitEdit(false);
    }));
    box.appendChild(field('Host notes', 'textarea', bonus.notes || '', function (v) {
      bonus.notes = v; commitEdit(false);
    }));

    var pay = document.createElement('div');
    pay.className = 'payout-fields';
    [['first', 'Winning team, per pair'], ['second', 'Losing team, per pair'],
     ['split', 'Third pair, no gamble'], ['win', 'Bonus won'], ['lose', 'Bonus lost']
    ].forEach(function (spec) {
      var wrap = document.createElement('div');
      wrap.className = 'edit-field';
      var label = document.createElement('label');
      label.textContent = spec[1];
      var input = document.createElement('input');
      input.type = 'number';
      bonus.payout = bonus.payout || {};
      input.value = String(payoutFor(spec[0]));
      input.addEventListener('input', function () {
        bonus.payout[spec[0]] = Number(input.value) || 0; commitEdit(false);
      });
      wrap.appendChild(label);
      wrap.appendChild(input);
      pay.appendChild(wrap);
    });
    box.appendChild(pay);

    var cluesLabel = document.createElement('label');
    cluesLabel.style.cssText = 'display:block;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin:.7rem 0 .3rem';
    cluesLabel.textContent = 'Clues';
    box.appendChild(cluesLabel);

    bonus.clues = bonus.clues || [];
    bonus.clues.forEach(function (clue, ci) {
      var row = document.createElement('div');
      row.className = 'answer-row clue-row';

      var idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(ci + 1);

      var qIn = document.createElement('input');
      qIn.type = 'text';
      qIn.value = clue.question || '';
      qIn.placeholder = 'Question';
      qIn.addEventListener('input', function () { clue.question = qIn.value; commitEdit(false); });

      var aIn = document.createElement('input');
      aIn.type = 'text';
      aIn.value = clue.answer || '';
      aIn.placeholder = 'Their answer';
      aIn.addEventListener('input', function () { clue.answer = aIn.value; commitEdit(false); });

      var del = smallBtn('✕', 'Delete clue', function () {
        bonus.clues.splice(ci, 1);
        state.bonus.revealed = {};
        commitEdit(true);
      });

      row.appendChild(idx);
      row.appendChild(qIn);
      row.appendChild(aIn);
      row.appendChild(del);
      box.appendChild(row);
    });

    var add = smallBtn('+ Add clue', '', function () {
      bonus.clues.push({ question: 'New question?', answer: 'Their answer' });
      commitEdit(true);
    });
    add.style.marginTop = '.4rem';
    box.appendChild(add);

    return box;
  }

  function buildRoundEditor(round, ri) {
    var box = document.createElement('div');
    box.className = 'edit-round';

    var head = document.createElement('div');
    head.className = 'edit-round-head';
    var title = document.createElement('h3');
    title.textContent = 'Round ' + (ri + 1);
    var actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.appendChild(smallBtn('↑', 'Move up', function () { moveRound(ri, -1); }));
    actions.appendChild(smallBtn('↓', 'Move down', function () { moveRound(ri, 1); }));
    actions.appendChild(smallBtn('Delete round', '', function () { deleteRound(ri); }));
    head.appendChild(title);
    head.appendChild(actions);
    box.appendChild(head);

    box.appendChild(field('Question', 'text', round.question, function (v) {
      round.question = v; commitEdit(false);
    }));

    box.appendChild(field('Glitch question (optional — swaps in on ⚡)', 'text', round.glitchQuestion || '', function (v) {
      if (v.trim()) round.glitchQuestion = v; else delete round.glitchQuestion;
      commitEdit(false);
    }));

    box.appendChild(field('Host notes (bonus points, callouts)', 'textarea', round.notes || '', function (v) {
      round.notes = v; commitEdit(false);
    }));

    var ansLabel = document.createElement('label');
    ansLabel.style.cssText = 'display:block;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin:.7rem 0 .3rem';
    ansLabel.textContent = 'Answers';
    box.appendChild(ansLabel);

    round.answers.forEach(function (answer, ai) {
      box.appendChild(buildAnswerEditor(round, answer, ri, ai));
    });

    var addA = smallBtn('+ Add answer', '', function () {
      round.answers.push({ text: 'New answer', points: 1 });
      commitEdit(true);
    });
    addA.style.marginTop = '.4rem';
    box.appendChild(addA);

    return box;
  }

  function buildAnswerEditor(round, answer, ri, ai) {
    var frag = document.createDocumentFragment();
    var row = document.createElement('div');
    row.className = 'answer-row';

    var idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(ai + 1);

    var textIn = document.createElement('input');
    textIn.type = 'text';
    textIn.value = answer.text || '';
    textIn.addEventListener('input', function () { answer.text = textIn.value; commitEdit(false); });

    var ptsIn = document.createElement('input');
    ptsIn.type = 'number';
    ptsIn.min = '0';
    if (answer.type === 'list') {
      ptsIn.value = String(answer.pointsPerItem || 1);
      ptsIn.title = 'Points per checklist item';
      ptsIn.addEventListener('input', function () {
        answer.pointsPerItem = Number(ptsIn.value) || 0; commitEdit(false);
      });
    } else {
      ptsIn.value = String(answer.points || 0);
      ptsIn.title = 'Points';
      ptsIn.addEventListener('input', function () {
        answer.points = Number(ptsIn.value) || 0; commitEdit(false);
      });
    }

    var toggle = smallBtn(answer.type === 'list' ? 'Make normal' : 'Make checklist', '', function () {
      if (answer.type === 'list') {
        delete answer.type; delete answer.items; delete answer.noStrike;
        answer.points = answer.pointsPerItem || 1;
        delete answer.pointsPerItem;
      } else {
        answer.type = 'list';
        answer.pointsPerItem = answer.points || 1;
        answer.noStrike = true;
        answer.items = answer.items || [];
        delete answer.points;
      }
      clearRoundProgress(ri);
      commitEdit(true);
    });

    var del = smallBtn('✕', 'Delete answer', function () {
      round.answers.splice(ai, 1);
      clearRoundProgress(ri);
      commitEdit(true);
    });

    row.appendChild(idx);
    row.appendChild(textIn);
    row.appendChild(ptsIn);
    row.appendChild(toggle);
    row.appendChild(del);
    frag.appendChild(row);

    if (answer.type === 'list') {
      var items = document.createElement('div');
      items.className = 'list-items';

      var noStrikeWrap = document.createElement('label');
      noStrikeWrap.style.cssText = 'display:flex;gap:.4rem;align-items:center;font-size:.85rem;margin-bottom:.3rem';
      var noStrikeBox = document.createElement('input');
      noStrikeBox.type = 'checkbox';
      noStrikeBox.checked = answer.noStrike !== false;
      noStrikeBox.addEventListener('change', function () {
        answer.noStrike = noStrikeBox.checked; commitEdit(false);
      });
      noStrikeWrap.appendChild(noStrikeBox);
      noStrikeWrap.appendChild(document.createTextNode('Guessing one of these never costs a strike'));
      items.appendChild(noStrikeWrap);

      items.appendChild(field('Checklist items (one per line)', 'textarea',
        (answer.items || []).join('\n'), function (v) {
          answer.items = v.split('\n').map(function (s) { return s.trim(); })
                          .filter(function (s) { return s.length; });
          clearRoundProgress(ri);
          commitEdit(false);
        }));

      frag.appendChild(items);
    }

    return frag;
  }

  function field(labelText, kind, value, onInput) {
    var wrap = document.createElement('div');
    wrap.className = 'edit-field';
    var label = document.createElement('label');
    label.textContent = labelText;
    var input = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
    if (kind !== 'textarea') input.type = 'text';
    input.value = value || '';
    input.addEventListener('input', function () { onInput(input.value); });
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function smallBtn(text, title, onClick) {
    var b = document.createElement('button');
    b.className = 'btn btn-tiny';
    b.type = 'button';
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  /** Save edits. `rebuild` re-renders the editor DOM (loses focus), so it is
   *  only used for structural changes, never for plain typing. */
  function commitEdit(rebuild) {
    save();
    render();
    if (rebuild) renderEditor();
  }

  function clearRoundProgress(ri) {
    state.rounds[String(ri)] = blankRoundState();
  }

  function moveRound(ri, dir) {
    var to = ri + dir;
    if (to < 0 || to >= state.data.rounds.length) return;
    var rounds = state.data.rounds;
    var tmp = rounds[ri];
    rounds[ri] = rounds[to];
    rounds[to] = tmp;
    var a = state.rounds[String(ri)];
    var b = state.rounds[String(to)];
    state.rounds[String(ri)] = b || blankRoundState();
    state.rounds[String(to)] = a || blankRoundState();
    if (state.roundIndex === ri) state.roundIndex = to;
    else if (state.roundIndex === to) state.roundIndex = ri;
    commitEdit(true);
  }

  function deleteRound(ri) {
    if (!window.confirm('Delete round ' + (ri + 1) + '?')) return;
    state.data.rounds.splice(ri, 1);
    // Re-key per-round progress around the removed index.
    var next = {};
    Object.keys(state.rounds).forEach(function (k) {
      var i = Number(k);
      if (i < ri) next[k] = state.rounds[k];
      else if (i > ri) next[String(i - 1)] = state.rounds[k];
    });
    state.rounds = next;
    if (state.roundIndex >= state.data.rounds.length) {
      state.roundIndex = Math.max(0, state.data.rounds.length - 1);
    }
    commitEdit(true);
  }

  function addRound() {
    state.data.rounds.push({
      question: 'New question',
      notes: '',
      answers: [
        { text: 'Answer 1', points: 5 },
        { text: 'Answer 2', points: 4 },
        { text: 'Answer 3', points: 3 },
        { text: 'Answer 4', points: 2 },
        { text: 'Answer 5', points: 1 }
      ]
    });
    state.roundIndex = state.data.rounds.length - 1;
    commitEdit(true);
    el.editBody.scrollTop = el.editBody.scrollHeight;
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'questions.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.rounds)) throw new Error('no rounds array');
        state.data = parsed;
        state.rounds = {};
        state.roundIndex = 0;
        commitEdit(true);
        window.alert('Loaded ' + parsed.rounds.length + ' rounds.');
      } catch (e) {
        window.alert("That file didn't look like a questions.json export.\n\n" + e.message);
      }
    };
    reader.readAsText(file);
  }

  function restoreDefaults() {
    if (!window.confirm('Replace the current questions with the original deck? Your edits are lost unless you exported them.')) return;
    state.data = clone(defaults);
    state.rounds = {};
    state.roundIndex = 0;
    commitEdit(true);
  }

  /* ------------------------------------------------------------------ modal */

  function show(id) { el[id].hidden = false; }
  function hide(id) { el[id].hidden = true; }
  function anyModalOpen() {
    return !el.editModal.hidden || !el.helpModal.hidden || !el.freeGuessModal.hidden;
  }

  /* ------------------------------------------------------------------ wiring */

  function wire() {
    el.prevRound.addEventListener('click', function () { goToRound(state.roundIndex - 1); });
    el.nextRound.addEventListener('click', function () { goToRound(state.roundIndex + 1); });
    el.roundSelect.addEventListener('change', function () { goToRound(Number(el.roundSelect.value)); });

    el.strikeBtn.addEventListener('click', addStrike);
    el.clearStrikes.addEventListener('click', function () {
      roundState().strikes = 0; save(); render();
    });
    el.awardA.addEventListener('click', function () { awardPot(0); });
    el.awardB.addEventListener('click', function () { awardPot(1); });
    el.glitchBtn.addEventListener('click', toggleGlitch);
    el.freeGuessBtn.addEventListener('click', openFreeGuesses);

    el.revealHost.addEventListener('click', function () {
      state.bonus.hostRevealed = !state.bonus.hostRevealed;
      if (state.bonus.hostRevealed) play('award');
      save(); render();
    });
    el.bonusWin.addEventListener('click', function () { setBonusOutcome('win'); });
    el.bonusLose.addEventListener('click', function () { setBonusOutcome('lose'); });
    el.bonusSplit.addEventListener('click', function () { setBonusOutcome('split'); });
    el.bonusClear.addEventListener('click', function () {
      state.bonus = { revealed: {}, hostRevealed: false, outcome: null };
      save(); render();
    });

    el.notesBtn.addEventListener('click', function () {
      state.notesOpen = !state.notesOpen; save(); render();
    });
    el.resetRound.addEventListener('click', resetRound);
    el.resetGame.addEventListener('click', resetGame);

    el.muteBtn.addEventListener('click', function () { state.muted = !state.muted; save(); render(); });
    el.helpBtn.addEventListener('click', function () { show('helpModal'); });
    el.editBtn.addEventListener('click', function () { renderEditor(); show('editModal'); });

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { hide(b.getAttribute('data-close')); });
    });
    [el.editModal, el.helpModal, el.freeGuessModal].forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.hidden = true; });
    });

    el.addRound.addEventListener('click', addRound);
    el.exportBtn.addEventListener('click', exportJson);
    el.importBtn.addEventListener('click', function () { el.importFile.click(); });
    el.restoreBtn.addEventListener('click', restoreDefaults);
    el.importFile.addEventListener('change', function () {
      if (el.importFile.files[0]) importJson(el.importFile.files[0]);
      el.importFile.value = '';
    });

    document.querySelectorAll('.team-adjust button').forEach(function (b) {
      b.addEventListener('click', function () {
        adjustScore(Number(b.dataset.team), Number(b.dataset.delta));
      });
    });

    el.teamAName.addEventListener('input', function () { state.teamNames[0] = el.teamAName.value; save(); render(); });
    el.teamBName.addEventListener('input', function () { state.teamNames[1] = el.teamBName.value; save(); render(); });

    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      ['editModal', 'helpModal', 'freeGuessModal'].forEach(hide);
      return;
    }
    if (anyModalOpen()) return;

    var k = e.key;
    if (k >= '0' && k <= '9') {
      if (onBonus()) toggleClue(k === '0' ? 9 : Number(k) - 1);
      else if (k !== '0') toggleReveal(Number(k) - 1);
      e.preventDefault();
      return;
    }

    // Strikes, the pot and glitches mean nothing on the bonus round.
    if (onBonus() && 'xcabg'.indexOf(k.toLowerCase()) !== -1) return;

    switch (k.toLowerCase()) {
      case 'x': addStrike(); break;
      case 'c': roundState().strikes = 0; save(); render(); break;
      case 'a': awardPot(0); break;
      case 'b': awardPot(1); break;
      case 'g': toggleGlitch(); break;
      case 'n': state.notesOpen = !state.notesOpen; save(); render(); break;
      case 'm': state.muted = !state.muted; save(); render(); break;
      case 'e': renderEditor(); show('editModal'); e.preventDefault(); break;
      case 'arrowleft': goToRound(state.roundIndex - 1); break;
      case 'arrowright': goToRound(state.roundIndex + 1); break;
      case '?': case '/': show('helpModal'); break;
      default: return;
    }
    e.preventDefault();
  }

  /* -------------------------------------------------------------------- boot */

  fetch('questions.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      defaults = data;
      state = load() || freshState(data);
      recomputePot();
      el.app.hidden = false;
      wire();
      render();
    })
    .catch(function (err) {
      document.body.innerHTML =
        '<div style="max-width:44rem;margin:4rem auto;padding:2rem;font:16px/1.6 system-ui;color:#fff">' +
        '<h1 style="color:#ffc31f">Could not load questions.json</h1>' +
        '<p>' + String(err.message) + '</p>' +
        '<p>Opening <code>index.html</code> straight off the filesystem blocks the fetch. ' +
        'Run a local server instead: <code>python3 -m http.server</code> in this folder, ' +
        'then open <code>http://localhost:8000</code>.</p></div>';
    });
})();
