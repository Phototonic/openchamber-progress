#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s nullglob
umask 077

# No device, mount, target, or profile is supplied by the caller. Run from the
# repository root as the ordinary user, on a disposable Linux machine only.
if [[ $# != 1 || ( $1 != --ci && $1 != --local ) || $EUID == 0 ]]; then
  printf 'invocation=false\n'
  exit 1
fi

# System tools and test failures can print local paths and device identifiers.
# The public trace contains only fixed case names, booleans and counts.
exec 2>/dev/null
case_name=prerequisites
passed=0
trap 'printf "%s=false\n" "$case_name"' ERR
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

pass() {
  printf '%s=true\n' "$case_name"
  passed=$((passed + 1))
}

admin() { sudo -n "$@"; }
settle() { admin udevadm settle --timeout=15; }

[[ $(uname -s) == Linux && -f scripts/run-setup-btrfs-qa.sh ]]
for tool in btrfs mkfs.btrfs targetcli mkfs.ext4 losetup mount umount mountpoint \
  findmnt blkid blockdev modprobe udevadm node timeout sudo; do
  command -v "$tool" >/dev/null
done
admin true
admin modprobe tcm_loop
# Don't let targetcli mount configfs or restore/save global configuration.
[[ $(findmnt -rn -M /sys/kernel/config -o FSTYPE) == configfs ]]
pass

case_name=private_fixture
root=$(mktemp -d /tmp/setup-btrfs-qa.XXXXXXXXXX)
target_config=/sys/kernel/config/target
read -r token </proc/sys/kernel/random/uuid
target="naa.5${token:0:8}${token:9:4}${token:14:3}"
target_path="$target_config/loopback/$target"
image="$root/original.img"
copy_image="$root/copy.img"
original_backstore="setup-${token}-original"
copy_backstore="setup-${token}-copy"
direct="$root/reviewed"
top="$root/top"
spacer="$root/spacer"
control_mount="$root/control"
store="$direct/store"
driver=tests/fixtures/setup-btrfs-native.test.ts
driver_present=false
if [[ -f $driver ]]; then driver_present=true; fi
actions=()
objects=()
lun_sysfs=
lun_device=
lun_wwn=

# Calls with a CLI command (not an interactive shell); the private preferences
# also disable auto-save explicitly before any configuration is changed.
tcli() {
  admin env "TARGETCLI_HOME=$root/targetcli" targetcli "$@" >/dev/null
}

backstore_path() {
  admin find "$target_config/core" -mindepth 2 -maxdepth 2 -type d -name "$1"
}

associated_loop() {
  admin losetup --list --noheadings --output NAME --associated "$1"
}

register() {
  actions+=("$1")
  objects+=("$2")
}

# If interrupted mid-command, check for the specific object in its owned
# location. Never detach another loop minor or clear a target tree wholesale.
remove_owned() {
  local kind=$1 object=$2 device
  case "$kind" in
    mount)
      if mountpoint -q "$object"; then
        admin umount -- "$object" || return 1
      fi
      ! mountpoint -q "$object"
      ;;
    loop)
      device=$(associated_loop "$object") || return 1
      if [[ -n $device ]]; then
        [[ $device =~ ^/dev/loop[0-9]+$ ]] || return 1
        admin losetup --detach "$device" && settle || return 1
      fi
      device=$(associated_loop "$object") && [[ -z $device ]]
      ;;
    lun)
      if admin test -d "$target_path/tpgt_1/lun/lun_0"; then
        tcli "/loopback/$target/luns" delete 0 || return 1
      fi
      settle || return 1
      ! admin test -e "$target_path/tpgt_1/lun/lun_0" &&
        [[ -z $lun_sysfs || ! -e $lun_sysfs ]] &&
        [[ -z $lun_wwn || ! -L /dev/disk/by-id/wwn-"$lun_wwn" ]]
      ;;
    target)
      if admin test -d "$target_path"; then
        tcli /loopback delete "$object" || return 1
      fi
      ! admin test -e "$target_path"
      ;;
    backstore)
      device=$(backstore_path "$object") || return 1
      if [[ -n $device ]]; then
        tcli /backstores/fileio delete "$object" || return 1
      fi
      device=$(backstore_path "$object") && [[ -z $device ]]
      ;;
    *) return 1 ;;
  esac
}

release() {
  local kind=$1 object=$2 i
  for ((i = ${#actions[@]} - 1; i >= 0; i--)); do
    if [[ ${actions[i]:-} == "$kind" && ${objects[i]} == "$object" ]]; then
      remove_owned "$kind" "$object" || return 1
      actions[i]=''
      return 0
    fi
  done
  return 1
}

cleanup() {
  local result=$? i
  trap - EXIT ERR
  trap '' HUP INT TERM
  set +e
  for ((i = ${#actions[@]} - 1; i >= 0; i--)); do
    if [[ -n ${actions[i]} ]] && ! remove_owned "${actions[i]}" "${objects[i]}"; then
      # Don't withdraw a backing device (or delete files) behind a mount or
      # LUN that could not be removed. Leave it for the disposable host owner.
      printf 'cleanup=false\n'
      exit 1
    fi
  done
  if ! admin rm -rf --one-file-system -- "$root/targetcli" ||
     ! rm -rf --one-file-system -- "$root" || [[ -e $root ]]; then
    printf 'cleanup=false\n'
    exit 1
  fi
  printf 'cleanup=true\n'
  if ((result == 0)); then
    printf 'cases_passed=%d\n' "$((passed + 1))"
  fi
  exit "$result"
}
trap cleanup EXIT

admin install -d -m 700 "$root/targetcli"
tcli set global auto_save_on_exit=false
mkdir -m 700 -- "$direct" "$top" "$spacer" "$control_mount" "$root/profiles"
pass

# The phase driver remains the ordinary user. A profile persists only across
# related phases. Phase files, synthetic HOME/XDG roots and baseline data all
# live outside the filesystem under observation.
#   AP_BTRFS_PHASE: bare-loop | seed | snapshot | copy | original | controls
#   AP_BTRFS_CONTROL: ext4 | ext4-copy | tmpfs (empty outside controls)
#   AP_BTRFS_PROFILE, AP_BTRFS_STORE, AP_BTRFS_TOP: fixture locations
# AP_BTRFS_TOP is usable only when mounted (including the nested snapshot check).
run_phase() {
  local phase=$1 profile="$root/profiles/$2" phase_store=$3 control=${4:-}
  local tap="$root/phase.tap" counts tests ok skipped todo
  if [[ $driver_present == false ]]; then
    # The initial feasibility PR can run before the product integration driver
    # exists. Its only phase is the built-in preflight result, never acceptance.
    if [[ $phase == preflight ]]; then
      printf 'preflight_only=true\n'
    fi
    return 0
  fi
  if [[ $phase == preflight ]]; then return 0; fi
  [[ -f $driver ]]
  mkdir -p -- "$profile"/{home,config,data,state,cache,runtime,tmp}
  if ! env -i PATH="$PATH" HOME="$profile/home" TMPDIR="$profile/tmp" \
    XDG_CONFIG_HOME="$profile/config" XDG_DATA_HOME="$profile/data" \
    XDG_STATE_HOME="$profile/state" XDG_CACHE_HOME="$profile/cache" \
    XDG_RUNTIME_DIR="$profile/runtime" AP_BTRFS_PHASE="$phase" \
    AP_BTRFS_CONTROL="$control" AP_BTRFS_PROFILE="$profile" \
    AP_BTRFS_STORE="$phase_store" AP_BTRFS_TOP="$top" \
    timeout -k 5 90 node --experimental-strip-types --test --test-concurrency=1 \
      --test-reporter=tap "$driver" >"$tap" 2>&1; then
    return 1
  fi
  counts=$(awk '$1=="#" && $2 ~ /^(tests|pass|skipped|todo)$/ && NF==3 && $3 ~ /^[0-9]+$/ { v[$2]=$3 }
    END { print v["tests"], v["pass"], v["skipped"], v["todo"] }' "$tap")
  read -r tests ok skipped todo <<<"$counts"
  [[ $tests =~ ^[1-9][0-9]*$ && $ok == "$tests" && $skipped == 0 && $todo == 0 ]]
  printf '%s_tests_passed=%s\n' "${control:-$phase}" "$ok"
}

attach_loop() {
  local file=$1 existing
  [[ -f $file && ! -L $file ]]
  existing=$(associated_loop "$file")
  [[ -z $existing ]]
  register loop "$file"
  loop_device=$(admin losetup --find --show "$file")
  [[ $loop_device =~ ^/dev/loop[0-9]+$ && -b $loop_device ]]
  [[ $(associated_loop "$file") == "$loop_device" ]]
  settle
}

mount_fixture() {
  local at=$1 fs=$2 source=$3 options=$4
  [[ -d $at && ! -L $at ]]
  if mountpoint -q "$at"; then return 1; fi
  register mount "$at"
  admin mount --internal-only -t "$fs" -o "nodev,nosuid,noexec,$options" -- "$source" "$at"
  [[ $(findmnt -rn -M "$at" -o FSTYPE) == "$fs" ]]
}

mount_btrfs() {
  local at=$1 source=$2 subvol=$3
  if [[ $subvol == / ]]; then
    mount_fixture "$at" btrfs "$source" subvolid=5
  else
    mount_fixture "$at" btrfs "$source" "subvol=$subvol"
  fi
  [[ $(findmnt -rn -M "$at" -o FSROOT) == "$subvol" ]]
}

make_store() {
  admin install -d -m 700 -o "$(id -u)" -g "$(id -g)" -- "$1"
}

create_backstore() {
  local name=$1 file=$2 existing
  existing=$(backstore_path "$name")
  [[ -z $existing && -f $file && ! -L $file ]]
  register backstore "$name"
  tcli /backstores/fileio create "$name" "$file" write_back=false
}

export_lun() {
  local name=$1 address entry resolved mapped backstore wwid properties deadline links=()
  address=$(admin cat "$target_path/tpgt_1/address")
  [[ $address =~ ^[0-9]+:0:1$ ]]
  lun_sysfs="/sys/class/scsi_device/$address:0"
  [[ ! -e $lun_sysfs && -z $lun_wwn ]]
  if admin test -e "$target_path/tpgt_1/lun/lun_0"; then return 1; fi
  register lun "$target"
  tcli "/loopback/$target/luns" create "/backstores/fileio/$name" lun=0
  # Correlate the exact configured mapping, then follow its SCSI address to
  # sysfs. Never pick a disk from a guessed node or a host-wide device listing.
  mapped=$(admin find "$target_path/tpgt_1/lun/lun_0" -maxdepth 1 -type l)
  [[ -n $mapped && $mapped != *$'\n'* ]]
  resolved=$(admin readlink -e -- "$mapped")
  backstore=$(backstore_path "$name")
  [[ $resolved == "$backstore" ]]
  lun_serial=$(admin cat "$resolved/wwn/vpd_unit_serial")
  lun_serial=${lun_serial##* }
  [[ $lun_serial =~ ^[0-9a-fA-F-]{36}$ ]]
  # SCSI disk probing can finish after targetcli returns. Wait only for this
  # address's block node, then drain udev events before reading device metadata.
  deadline=$((SECONDS + 15))
  while :; do
    links=("$lun_sysfs"/device/block/*)
    [[ ${#links[@]} -le 1 ]]
    if [[ ${#links[@]} == 1 ]]; then
      entry=${links[0]##*/}
      lun_device="/dev/$entry"
      if [[ -b $lun_device ]]; then break; fi
    fi
    [[ $SECONDS -lt $deadline ]]
    sleep 0.1
  done
  settle
  wwid=$(<"$lun_sysfs/device/wwid")
  [[ $wwid =~ ^naa\.[0-9a-f]+$ ]]
  properties=$(udevadm info --query=property --name="$lun_device")
  [[ $properties =~ (^|$'\n')ID_WWN_WITH_EXTENSION=(0x[0-9a-f]+)($'\n'|$) ]]
  lun_wwn=${BASH_REMATCH[2]}
  [[ $lun_wwn == "0x${wwid#naa.}" ]]
  entry="/dev/disk/by-id/wwn-$lun_wwn"
  [[ -L $entry && $(readlink -e -- "$entry") == "$lun_device" ]]
}

withdraw_lun() {
  admin blockdev --flushbufs "$lun_device"
  release lun "$target"
  lun_sysfs=
  lun_device=
  lun_wwn=
}

fs_uuid() { admin blkid -p -s UUID -o value "$lun_device"; }
subvol_id() { admin btrfs inspect-internal rootid "$direct"; }
store_object() { stat -c '%i %w' -- "$store"; }

case_name=btrfs_loop
truncate -s 512M -- "$image"
attach_loop "$image"
admin mkfs.btrfs "$loop_device" >/dev/null
mount_btrfs "$top" "$loop_device" /
admin btrfs subvolume create "$top/original" >/dev/null
admin btrfs subvolume create "$top/spacer" >/dev/null
release mount "$top"
mount_btrfs "$direct" "$loop_device" /original
make_store "$store"
run_phase bare-loop bare-loop "$store"
release mount "$direct"
release loop "$image"
pass

case_name=fileio_wwn
create_backstore "$original_backstore" "$image"
if admin test -e "$target_path"; then
  printf '%s=false\n' "$case_name"
  exit 1
fi
register target "$target"
tcli /loopback create "$target"
export_lun "$original_backstore"
seed_serial=$lun_serial
seed_wwn=$lun_wwn
seed_uuid=$(fs_uuid)
[[ -n $seed_uuid ]]
pass

case_name=seed
mount_btrfs "$direct" "$lun_device" /original
seed_dev=$(stat -c '%d' -- "$store")
seed_object=$(store_object)
[[ $seed_object != *' -' ]]
seed_subvol=$(subvol_id)
[[ $seed_subvol =~ ^[0-9]+$ ]]
run_phase seed main "$store"
pass

case_name=snapshot
mount_btrfs "$top" "$lun_device" /
admin btrfs subvolume snapshot "$top/original" "$top/snapshot" >/dev/null
release mount "$direct"
mount_btrfs "$direct" "$lun_device" /snapshot
snapshot_subvol=$(subvol_id)
[[ $snapshot_subvol =~ ^[0-9]+$ && $snapshot_subvol != "$seed_subvol" ]]
[[ $(store_object) == "$seed_object" && $(fs_uuid) == "$seed_uuid" && $lun_wwn == "$seed_wwn" ]]
[[ -w $store && -d $top/snapshot/store ]]
run_phase snapshot main "$store"
release mount "$direct"
release mount "$top"
withdraw_lun
pass

case_name=offline_copy
cp --reflink=never --sparse=always -- "$image" "$copy_image"
cmp -s -- "$image" "$copy_image"
create_backstore "$copy_backstore" "$copy_image"
export_lun "$copy_backstore"
[[ $lun_serial != "$seed_serial" && $lun_wwn != "$seed_wwn" && $(fs_uuid) == "$seed_uuid" ]]
mount_btrfs "$direct" "$lun_device" /original
[[ $(subvol_id) == "$seed_subvol" && $(store_object) == "$seed_object" ]]
run_phase copy main "$store"
release mount "$direct"
withdraw_lun
release backstore "$copy_backstore"
pass

case_name=renumbered_original
export_lun "$original_backstore"
[[ $lun_serial == "$seed_serial" && $lun_wwn == "$seed_wwn" && $(fs_uuid) == "$seed_uuid" ]]
for ((i=0; i<32; i++)); do
  at="$root/reserve-$i"
  mkdir -- "$at"
  mount_fixture "$at" tmpfs tmpfs size=64k,mode=0700
done
mount_btrfs "$spacer" "$lun_device" /spacer
mount_btrfs "$direct" "$lun_device" /original
[[ $(stat -c '%d' -- "$store") != "$seed_dev" ]]
[[ $(subvol_id) == "$seed_subvol" && $(store_object) == "$seed_object" ]]
run_phase original main "$store"
release mount "$direct"
release mount "$spacer"
for ((i=31; i>=0; i--)); do
  release mount "$root/reserve-$i"
done
withdraw_lun
pass

case_name=ext4_control
ext4_image="$root/ext4.img"
ext4_copy="$root/ext4-copy.img"
control_store="$control_mount/store"
truncate -s 128M -- "$ext4_image"
attach_loop "$ext4_image"
ext4_loop=$loop_device
admin mkfs.ext4 -q "$ext4_loop"
mount_fixture "$control_mount" ext4 "$ext4_loop" rw
make_store "$control_store"
ext4_dev=$(stat -c '%d' -- "$control_store")
run_phase controls ext4 "$control_store" ext4
release mount "$control_mount"
admin blockdev --flushbufs "$ext4_loop"
# Keep the first allocation reserved; the offline ext4 copy must get a
# different loop minor. Only the copy is mounted for the second phase.
cp --reflink=never --sparse=always -- "$ext4_image" "$ext4_copy"
attach_loop "$ext4_copy"
[[ $loop_device != "$ext4_loop" ]]
mount_fixture "$control_mount" ext4 "$loop_device" rw
[[ $(stat -c '%d' -- "$control_store") != "$ext4_dev" ]]
run_phase controls ext4 "$control_store" ext4-copy
release mount "$control_mount"
release loop "$ext4_copy"
release loop "$ext4_image"
pass

case_name=tmpfs_control
mount_fixture "$control_mount" tmpfs tmpfs size=32m,mode=0700
admin chown -- "$(id -u):$(id -g)" "$control_mount"
make_store "$control_store"
run_phase controls tmpfs "$control_store" tmpfs
release mount "$control_mount"
pass

case_name=preflight
run_phase preflight main "$store"
