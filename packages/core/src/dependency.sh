#!/bin/bash

# Function to parse dependencies from objdump output

install_objdump_and_sudo() {
    case "$os_type" in
    "fedora" )
        dnf install -y sudo binutils
        ;;
    "ubuntu" | "debian")
      apt-get install -y sudo binutils
    esac
}

parse_dependencies() {
    local binary="$1"
    local objdump_output

    # Use objdump to get dependencies
    if objdump_output=$(objdump -p "$binary" 2>/dev/null); then
        # Extract shared library dependencies
        case "$os_type" in
        "fedora" | "ubuntu" | "debian")
            echo "$objdump_output" | grep -oP 'NEEDED\s+\K.*'
            ;;
        "alpine")
            echo "$objdump_output" | grep 'NEEDED' | awk '{print $2}'
            ;;
        esac
    else
        echo "Error: Failed to run objdump on $binary" >&2
        exit 1
    fi
}

# Function to convert library name format
convert_library_name() {
    local library_name="$1"
    case "$os_type" in
    "fedora" | "alpine" )
        echo "$library_name"
        ;;
    "ubuntu" | "debian")
        local library_name="$1"
        # Extract basename without extension
        local basename="${library_name%.so.*}"
        basename=$(echo "$basename" | sed 's/\(.*\)-/\1/')
        basename="${basename,,}"
        local part_at_end="$(basename "$library_name" | awk -F '\.so\.' '{print $2}')"
        local length="$(echo "$library_name" | awk -F'.' '{print NF-1}')"

        # Replace .so. with - if version number is present
        if [[ $length -gt 2 ]]; then
            local converted_name="$basename-$part_at_end"
        elif [[ $length == 1 ]]; then
            local converted_name="$(basename "$basename" | awk -F '\.so' '{print $1}')"
        else
            # Replace .so. with empty string if no version number is present
            local converted_name="$basename$part_at_end"
        fi
        echo "$converted_name"
        ;;
    esac
}

# Function to install dependency using the appropriate package manager
install_dependency() {
    local os_type="$1"
    local dependency="$2"
    local installed

    # Convert library name format
    local dependency_name=$(convert_library_name "$dependency")

    case "$os_type" in
    "fedora")
        # For Fedora, using dnf
        if sudo dnf install -y "$dependency_name"; then
            installed=true
        else
            installed=false
        fi
        ;;
    "ubuntu" | "debian")
        # For Ubuntu and Debian, using apt
        # sudo apt-get update
        if sudo apt-get install -y "$dependency_name"; then
            installed=true
        else
            installed=false
        fi
        ;;
    "alpine")
        # For Alpine Linux, using apk
        if sudo apk add "$dependency_name"; then
            installed=true
        else
            installed=false
        fi
        ;;
    *)
        echo "Can't install dependencies for $os_type"
        exit 1
        ;;
    esac

    # Log the installation status
    if "$installed"; then
        echo "Installed: $dependency"
    else
        echo "Not installed: $dependency"
        case "$os_type" in
            "ubuntu" | "debian" | "fedora")
          non_installed_dependencies+=("$dependency")
        ;;
        "alpine")
          (non_installed_dependencies+=("$dependency"))
        ;;
        esac
        ;;
    fi
}

# Function to search for non-installed dependencies in package manager
search_non_installed_dependencies() {
    local os_type="$1"

    echo "To search for non-installed dependencies, use the following command:"
    case "$os_type" in
    "ubuntu" | "debian")
        echo "sudo apt-cache search <package_name>"
        ;;
    "alpine")
        echo "sudo apk search <package_name>"
        ;;
    "fedora")
        echo "sudo dnf search <package_name>"
        ;;
    *)
        echo "Unsupported OS type: $os_type"
        exit 1
        ;;
    esac
}

# Function to print dependencies not found in ldd output
print_missing_dependencies() {
    ldd_output=$(ldd "$1" 2>/dev/null)
    if [ $? -ne 0 ]; then
        if [[ $ldd_output == *'not a dynamic executable'* ]]; then
            echo "Error: $1 is not a dynamic executable" >&2
            exit 1
        else
            echo "Error: Failed to run ldd on $1" >&2
            exit 1
        fi
    fi
    awk '/not found/ {print $1}' <<<"$ldd_output" | sed 's/://'
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
    if ! ldconfig -p | grep -qFx "$dependency"; then
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

missing_dependencies=$(print_missing_dependencies "$1")

# Print missing dependencies
if [ -z "$missing_dependencies" ]; then
    echo "No missing dependencies found."
else
    echo "Missing dependencies:"
    printf '%s\n' "$missing_dependencies"
fi
