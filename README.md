# Video App (TizenBrew module)

Opens a video website on a Samsung (Tizen) TV through TizenBrew and makes the remote work on it.

## Use it for a different website

Edit `package.json`:

- `"websiteURL"`: the site to open
- `"appName"`: the name shown in TizenBrew

To make a second app for a different site, copy this repo and change those two lines.

## Remote controls

| Button | What it does |
|---|---|
| Arrows | Move the blue highlight between links and buttons |
| OK | Click the highlighted item |
| Back | Exit fullscreen, else go back a page, else close the app |
| Play / Pause | Play or pause the video |
| Fast-forward / Rewind | Skip 10 s forward or back |
| Left / Right (fullscreen video) | Skip 10 s |

Pop-ups and new tabs are blocked; links that would open a new tab open in the same window instead.

## Install on the TV

1. Push this folder to a **public** GitHub repo.
2. In TizenBrew, open the module manager, choose **Add module**, and enter `gh/<your-github-username>/<repo-name>`.
3. The app appears on the TizenBrew home screen.

TizenBrew fetches GitHub modules through the jsDelivr CDN, which caches files. After you change `package.json`, the TV may keep the old version for a while.

## Limitation

If a site plays its video inside an embedded player from another domain (an iframe), the media keys can't reach that video. In that case use OK on the player's own buttons.
