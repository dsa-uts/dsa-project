#!/usr/bin/env nu
use kubernetes.nu *

def main [component: string = 'all'] {
  if $component not-in [all backend frontend] {
    error make { msg: 'expected all, backend, or frontend' }
  }
  let selected = if $component == 'all' { $image_specifications } else {
    $image_specifications | where label == $component
  }
  build-images ($env.FILE_PWD | path join .. | path expand) $selected
}
