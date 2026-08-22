# Deployed public-interface tests and their Node.js dependencies.
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

  nativeBuildInputs = [ pkgs.makeWrapper ];
  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/dsa-e2e $out/bin
    cp -r node_modules environment.ts package.json playwright.config.ts tests tsconfig.json $out/lib/dsa-e2e/
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/dsa-e2e \
      --add-flags "$out/lib/dsa-e2e/node_modules/@playwright/test/cli.js" \
      --add-flags "test" \
      --add-flags "--config=$out/lib/dsa-e2e/playwright.config.ts"
    runHook postInstall
  '';
}
