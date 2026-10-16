# Release checklist

1. **Version**: bump `package.json` (semver); Android `versionCode` is derived (`1.5.0` → `10500`).
2. **CHANGELOG.md**: add `## x.y.z — title` with Added / Changed / Fixed. The GitHub Release body is taken from it.
3. **Privacy**: review `PRIVACY.md` and the in-app policy (`/privacy`) if data flows changed.
4. **Security**: run the checklist in `SECURITY.md`.
5. **CI green** on `main`: lint, typecheck, unit, E2E, Lighthouse, size report.
6. **Manual matrix** in `TESTING.md` for the changed areas (always: chat streaming, offline, back button, backup/restore).
7. **Tag**: `git tag v1.5.0 && git push origin v1.5.0` → Android workflow builds and publishes the release with signed APK/AAB + `SHA256SUMS.txt`.
8. **Verify the release**: install the APK over the previous version (data kept), check the version in Settings → App & device.
9. **Announce** using `.github/RELEASE_TEMPLATE.md`.

Rollback: re-publish the previous tag's APK (same signing key, lower versionCode is rejected by Android; ship a new patch version instead).
