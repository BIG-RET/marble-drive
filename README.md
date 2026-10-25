# Marble Drive

A marble-in-a-dish smooth-driving app for phones. Mount the phone in the car, and a virtual marble rolls in a bowl as the car brakes, accelerates and turns. Smooth driving keeps the marble near the centre.

**Live app:** https://big-ret.github.io/marble-drive/

## Install on iPhone
1. Open the link above in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open Marble Drive from the home screen, tap anywhere, and choose **Allow** for motion access.

Tip: the ring/silent switch can mute sounds. Motion sensors need HTTPS, which the link provides.

## Using it
- **Set flat:** with the phone mounted and the car stopped, tap Set flat to zero the sensors. The dish curvature slider sets sensitivity (deeper = less sensitive).
- **Scoring:** live score = 100·(1 − d²), where d is the marble's distance from the centre (0 to 1). The trip score is the time-weighted average. Rim hits and the worst moment are tracked.
- **Stop freeze:** when the car is stopped (about 1 s of low jerk, acceleration spread under 0.15 m/s², and near-zero rotation), the score holds its value, including when parked on a hill. It resumes as soon as the car moves.
- **Sounds:** a metallic clang on rim hits (louder for harder hits) and a bell ding when the marble crosses the dotted middle ring. Toggle with Sound.
- **Baselines & history:** every trip over 5 s is saved to history. Make any trip a named baseline, turn on Compare to baseline to see your score against it, and tick two drives to compare side by side.
- No sensors? Drag the bowl to test.

## Development
```
npm install
npm run dev           # dev server
npm run build:single  # self-contained marble.html
npm run build:pwa     # installable PWA into pwa/
npm run deploy        # rebuild pwa/ and publish it to the gh-pages branch
```
