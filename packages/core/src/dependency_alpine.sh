#!/bin/bash

# Function to parse dependencies from objdump output

install_objdump_and_sudo() {
    apk add sudo binutils bash

}

parse_dependencies() {
    local binary="$1"
    local objdump_output

    # Use objdump to get dependencies
    if objdump_output=$(objdump -p "$binary" 2>/dev/null); then
      echo "$objdump_output" | grep 'NEEDED' | awk '{print $2}'
    else
        echo "Error: Failed to run objdump on $binary" >&2
        exit 1
    fi
}

# Function to convert library name format
convert_library_name() {
  local library_name="$1"
  local short_name="$(echo $library_name | cut -d'-' -f1 | cut -d'.' -f1)"
  echo "$(apk search $short_name | grep -E "^$short_name-[0-9]" | head -n 1 | cut -d'-' -f1 | cut -d'.' -f1)"
}

# Function to install dependency using the appropriate package manager
install_dependency() {
    local os_type="$1"
    local dependency="$2"
    local installed

    # Convert library name format
    local dependency_name=$(convert_library_name "$dependency")

    # For Alpine Linux, using apk
    if sudo apk add "$dependency_name"; then
        installed=true
    else
        installed=false
    fi

    # Log the installation status
    if "$installed"; then
        echo "Installed: $dependency"
    else
        echo "Not installed: $dependency"
        non_installed_dependencies+=("$dependency")
    fi
}

# Function to search for non-installed dependencies in package manager
search_non_installed_dependencies() {
    local os_type="$1"

    echo "To search for non-installed dependencies, use the following command:"
    echo "sudo apk search <package_name>"
}

# Get the OS type
os_type=$(awk -F= '/^ID=/ {print $2}' /etc/os-release | tr -d '"')

# Validate input arguments
if [ $# -ne 1 ]; then
    echo "Usage: $0 <executable>"
    exit 1
fi

install_objdump_and_sudo

# Parse dependencies
dependencies=$(parse_dependencies "$1")

# Initialize array to store non-installed dependencies
non_installed_dependencies=()

# Install dependencies if not found
for dependency in $dependencies; do
    if ! apk info --installed "$dependency"; then
        install_dependency "$os_type" "$dependency"
    fi
done

# Provide instructions to search for non-installed dependencies
if [ ${#non_installed_dependencies[@]} -gt 0 ]; then
    echo "The following dependencies were not installed:"
    for non_installed_dependency in "${non_installed_dependencies[@]}"; do
        echo "- $non_installed_dependency"
    done
    echo
    search_non_installed_dependencies "$os_type"
fi
