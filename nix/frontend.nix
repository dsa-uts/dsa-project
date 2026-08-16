# frontend の静的ビルド成果物 (Vite の dist)
{ pkgs }:
pkgs.buildNpmPackage {
  pname = "dsa-frontend";
  version = "0.1.0";
  src = ../frontend;
  npmDeps = pkgs.importNpmLock { npmRoot = ../frontend; };
  npmConfigHook = pkgs.importNpmLock.npmConfigHook;
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
