{ pkgs, manifests }:
pkgs.writeShellApplication {
  name = "render-local-manifests";
  meta.description = "Render the local Kustomize overlay with immutable image tags";
  runtimeInputs = with pkgs; [
    coreutils
    kustomize
  ];
  text = ''
    if [ "$#" -ne 2 ]; then
      echo "usage: render-local-manifests BACKEND_TAG FRONTEND_TAG" >&2
      exit 2
    fi

    backend_tag="$1"
    frontend_tag="$2"
    render_dir=$(mktemp -d)

    cleanup() {
      chmod -R u+w "$render_dir"
      rm -r -- "$render_dir"
    }
    trap cleanup EXIT

    cp -R ${manifests} "$render_dir/deploy"
    chmod -R u+w "$render_dir/deploy"
    cd "$render_dir/deploy/overlays/local"
    kustomize edit set image \
      "dsa-backend=dsa-backend:$backend_tag" \
      "dsa-frontend=dsa-frontend:$frontend_tag"
    kustomize build .
  '';
}
