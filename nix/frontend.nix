# frontend の静的ビルド成果物 (Vite の dist)。flake.nix から system ごとに import される。
# package.json / package-lock.json を変更したら npmDepsHash を更新すること
# (lib.fakeHash に置き換えて nix build し、エラーに出る正しい hash を貼り直す)。
{ pkgs }:
pkgs.buildNpmPackage {
  pname = "dsa-frontend";
  version = "0.1.0";
  src = ../frontend;
  npmDepsHash = "sha256-ZvH75xu6Y8Yimg0Obv7a1QMIccLm/Wl6VNFQZVm6NDo=";
  nodejs = pkgs.nodejs_24;

  # `npm run build` (tsc -b && vite build) が buildPhase で走る。
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';
}
