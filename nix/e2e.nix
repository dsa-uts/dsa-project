# Static validation only; host test execution reads the working directory.
{ pkgs }:
pkgs.buildNpmPackage {
  pname = "dsa-e2e";
  version = "0.1.0";
  src = ../e2e;
  npmDeps = pkgs.importNpmLock { npmRoot = ../e2e; };
  npmConfigHook = pkgs.importNpmLock.npmConfigHook;
  nodejs = pkgs.nodejs_24;

  dontNpmBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm run typecheck
    npm test -- --list
    runHook postCheck
  '';

  installPhase = "mkdir -p $out; touch $out/checked";
}
