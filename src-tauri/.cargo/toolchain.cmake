# Points CMake at the Ninja downloaded by `npm install` (scripts/setup-tools.mjs).
# The compiler itself is passed by the cmake crate - the same MSVC cargo uses.
set(CMAKE_MAKE_PROGRAM "${CMAKE_CURRENT_LIST_DIR}/../../tools/cmake/bin/ninja.exe" CACHE FILEPATH "Ninja from tools/")

# The Rust side links the CRT statically (crt-static), so libopus must too, or two CRTs get mixed
# (linker warning LNK4098 'MSVCRT' conflicts). libopus overwrites CMAKE_MSVC_RUNTIME_LIBRARY itself
# from this option, so setting the CMake variable directly has no effect.
set(OPUS_STATIC_RUNTIME ON CACHE BOOL "Static CRT to match crt-static")
