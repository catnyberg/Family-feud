# Family Feud — Friends Edition

An interactive Family Feud board for hosting the game live, built from the original
"Friends Edition" slide deck (survey of 23 guests, 10 rounds).

Every answer stays hidden until you click it. There's a strike button, running scores for two
teams, a bonus round that settles the end-of-game prize scoring, a built-in editor for changing
questions, and a reset — all in a static page with no build step and no server.

## Hosting a game

Open the page on the machine driving the projector and work top to bottom:

| Thing | How |
| --- | --- |
| Reveal an answer | Click the cell, or press its number `1`–`5` |
| Un-reveal (misclick) | Click it again |
| Strike | **✖ Strike** button, or `X` — full-screen red X plus a buzzer |
| Score a round | Revealed answers pile into the **round pot**; click *Award pot to …* (or `A` / `B`) to bank it |
| Bonus / penalty points | The `−5 −1 +1 +5` buttons under each team's score |
| Change round | Arrows, the dropdown, or `←` / `→` |
| Host notes | **Host notes** or `N` — bonus-point rules from the deck, hidden by default so the projected screen stays clean |

Team names are editable — click "Team A" and type over it. Everything (scores, reveals,
strikes, names, edits) is saved in the browser, so a refresh mid-game loses nothing.

### Two special rounds

**Round 8 — Least memorable US President.** The fifth slot isn't a single answer, it's a
checklist of the twelve presidents who each got exactly one vote. Reveal it and tick each one a
team names; every tick adds 1 point to the pot. Because the round has a checklist, a **Free
guesses** button appears — open it any time to see the board answers *and* the twelve names in
one list, so you can check a guess before deciding on a strike. **Guessing any name on that list
never costs a strike** — only a president in neither place does. The app never strikes on its
own; the button is always yours.

**Round 10 — the glitch.** The round opens on "An app you'd be embarrassed to share your weekly
screen time on." Hit **⚡ Glitch** (or `G`) and the question tears itself apart and resolves into
"Your worst personality trait, determined by the app you spend the most time on" — which is what
the answers on the board are actually written for. Press it again to swap back if you want to
rehearse it.

### The bonus round

After Round 10 comes the **Bonus Round**, for settling the final scoring rule. The board is
replaced by ten clue cards — one survey answer per round, all given by the same person. Reveal
them one at a time (click, or press `1`–`9` and `0` for the tenth) while the third-place pair
tries to work out whose answers they are.

**Reveal the answer** shows who it was, then record what happened:

| Button | Meaning |
| --- | --- |
| Guessed right | The pair gambled and won — 5 points each |
| Guessed wrong | The pair gambled and lost — 1 point each |
| Declined the gamble | The pair kept the guaranteed 3 points |

Underneath, **Final scoring** works out the whole prize table live from the two team totals: the
winning team's pairs take 5 points each, the losing team's pairs take 1, and the third-place
pair's line updates with whichever option they took. A tie is called out rather than guessed at.

These are prize points for the pairs, deliberately separate from the team scores on the board —
recording an outcome never changes Team A or Team B's total. **Clear result** re-hides everything
if you want to run it again.

The person, the prompt, the clue list and all five payout numbers are editable — the answer
defaults to "The Host", so change it to your name in the editor.

### Resetting

- **Reset round** — clears reveals, strikes and the pot for the current round only. (On the bonus
  round this is **Clear result** instead.)
- **Reset game** — scores to zero, back to round 1, everything cleared. Your questions are kept.

### Keyboard shortcuts

`1`–`5` reveal · `X` strike · `C` clear strikes · `A`/`B` award pot · `←`/`→` round ·
`G` glitch · `N` notes · `M` mute · `E` editor · `?` this list

On the bonus round, `1`–`9` and `0` reveal the ten clues; strike and pot keys do nothing there.

## Editing questions

Click **Edit** (or press `E`). You can change any question, its host notes and each answer's
text and points; add or delete answers; and add, delete or reorder whole rounds.

- **Glitch question** — fill this in on any round to give it the ⚡ swap gag.
- **Make checklist** — turns an answer into a tick-list like Round 8's, with points per item and
  the "never costs a strike" rule.
- **★ Bonus round** — at the bottom: the prompt, who the answers belong to, the clue pairs, and
  the five payout values (winning team, losing team, no-gamble split, bonus won, bonus lost).

Edits save to your browser as you type. They are local to that browser — to make them permanent
for everyone, click **Export JSON** and commit the downloaded file over `questions.json`:

```sh
cp ~/Downloads/questions.json .
git add questions.json && git commit -m "Update questions" && git push
```

**Import JSON** loads an export back (handy for moving between laptops), and **Restore deck
defaults** puts the original ten rounds back.

> Note: `questions.json` is the starting point loaded on a browser's *first* visit. Once you've
> edited in that browser, its local copy wins. After committing a new `questions.json`, use
> *Restore deck defaults* to pick it up.

## Running it locally

The page fetches `questions.json`, which browsers block when you open `index.html` directly off
disk. Serve the folder instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publishing to GitHub Pages

In the repo, go to **Settings → Pages**, set *Source* to **Deploy from a branch**, and pick the
branch holding these files with folder `/ (root)`. The site lands at
`https://<user>.github.io/<repo>/`. No build step or workflow is needed — `.nojekyll` is included
so Pages serves the files as-is.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page structure — board, controls, scores, editor |
| `styles.css` | The look; projector-sized, works down to a phone |
| `app.js` | Game state, rendering, editor, WebAudio sound effects |
| `questions.json` | The ten rounds from the deck, plus the bonus round |
