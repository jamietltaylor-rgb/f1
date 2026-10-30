# Replay 3D

Watch Formula 1 sessions replayed as 3D cars on a 3D track you can fly around.
Uses the free historical data from OpenF1 (https://openf1.org). No account, no key, no AI.

- Opens on a model of Silverstone with simulated cars, so there is always something to look at.
- Pick a finished session, a starting lap and a length, then press Load replay. The track shape is drawn from the real position data, so it works for any circuit.
- Click a car (or a driver in the list) to follow it. Drag to turn, scroll or pinch to zoom, right-drag or two fingers to move.

## Put it online (same way as your other apps)
1. Make a new GitHub repository and upload everything in this folder (the `public` folder, `wrangler.jsonc`, `README.md`).
2. Cloudflare -> Workers & Pages -> Create -> Import a repository. Leave the build command empty. Deploy command: `npx wrangler deploy`.
3. Add a custom domain, for example f1.jamietaylor.org.

## Notes
- The free OpenF1 tier is rate limited, so loading a replay fetches a minute of data at a time and takes a few seconds per minute of replay.
- Live sessions need a paid OpenF1 account. A finished session's data usually appears some time after the session ends.
- Three.js (MIT licence) is included in `public/vendor` so the site has no outside code dependencies.
- Unofficial fan project, not connected to Formula 1.
