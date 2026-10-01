#!/usr/bin/env nu
use kubernetes.nu *

def main [component: string = 'all'] {
  if $component not-in [all backend judge frontend loader] {
    error make { msg: 'expected all, backend, judge, frontend, or loader' }
  }
  let selected = if $component == 'all' { $image_specifications } else {
    $image_specifications | where label == $component
  }
  build-images ($env.FILE_PWD | path join .. | path expand) $selected
}
