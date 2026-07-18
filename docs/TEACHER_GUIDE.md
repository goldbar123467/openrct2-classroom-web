# Teacher rollout guide

## Licensing gate

Before giving students any RCT2 data, get written confirmation from district administration or counsel that the school’s license permits the intended number of student/device installations. OpenRCT2’s GPL license does not make the original RCT2 graphics, sound, scenarios, or object data free to distribute.

Do not place proprietary game files in GitHub, Vercel, a public Drive link, a CI artifact, or this repository. The safest Parkworks flow is a local student import from a district-approved source with access controls and documented rights.

## Pilot before class

1. Record the weakest Chromebook model, CPU, RAM, storage, screen resolution, and ChromeOS version.
2. Test the exact production URL on that model, not only a teacher laptop.
3. Import the approved ZIP and start a beginner scenario.
4. Verify build, rotate, zoom, pause, save, browser restart, device reboot, and resume.
5. Run a 60-minute medium-park session while watching ChromeOS Diagnostics for memory and thermal problems.
6. Export, erase, and restore a save backup; compare the recorded SHA-256 manifest.
7. Repeat on an ARM Chromebook if the fleet contains ARM devices.

Do not roll out class-wide until [the verification matrix](VERIFICATION.md) is signed for the lowest-spec device.

## Classroom routine

- Ask students to close unnecessary tabs before starting.
- Use **Classroom lite** on 4 GB devices.
- Start with small or medium maps and modest scenery density.
- Have students save in-game before major changes.
- Reserve the final five minutes for a local save plus exported Drive backup.
- Keep a non-canvas alternative activity available for students who need screen-reader access or reduced visual complexity.

## Data-loss expectations

IndexedDB is durable browser storage, not an institutional backup. A Powerwash, profile deletion, browser site-data clear, forced storage eviction, or damaged device can remove it. Student backup ZIPs should follow the district’s approved storage and retention policy.

## Incident response

If a new deployment breaks gameplay, stop class rollout, use the previous verified Vercel deployment, and preserve the affected student backup ZIPs. Do not ask students to repeatedly re-import or erase data until the incident owner has reproduced the problem.
