; Explorer integration, like VS Code's "Open with Code":
;  - "Open with Anchovy Player" in the context menu of audio files (whatever app is their default),
;    of folders, and of the empty space inside a folder;
;  - Anchovy Player listed under "Open with" for audio types, without taking over the default app.
; Optional, on by default: a checkbox on the welcome page. Passive and silent installs keep it on.
;
; Keep the extensions in sync with playableExtensions in src/modules/browser/entries.ts
; (video containers like mp4 and webm are left out on purpose).

!include LogicLib.nsh
!include nsDialogs.nsh

!define ANCHOVY_PROGID "AnchovyPlayer.Audio"
!define ANCHOVY_VERB "AnchovyPlayer"
!define ANCHOVY_VERB_LABEL "Open with Anchovy Player"

Var AnchovyExplorerCheckbox
; Empty until the welcome page is left, which means "on": the page is skipped in passive/silent mode.
Var AnchovyExplorerIntegration

; Tauri's template defines only PRE for the welcome page; these attach to that same page.
!define MUI_PAGE_CUSTOMFUNCTION_SHOW AnchovyWelcomeShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE AnchovyWelcomeLeave

; The license page (bundle.licenseFile) shows the GPL. It is a license to share and change the
; program, not terms of use, so the page informs and asks nothing: "Next" instead of "I Agree".
; Consumed by the license page's macro, which comes after the welcome page, so these do not clash.
!define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "You do not need to accept this license to use the program. It sets the terms for sharing and modifying it."

Function AnchovyWelcomeShow
  ${NSD_CreateCheckbox} 120u 170u 195u 12u "Add $\"${ANCHOVY_VERB_LABEL}$\" to Explorer"
  Pop $AnchovyExplorerCheckbox
  SetCtlColors $AnchovyExplorerCheckbox "" transparent
  ${If} $AnchovyExplorerIntegration == ${BST_UNCHECKED}
    ${NSD_SetState} $AnchovyExplorerCheckbox ${BST_UNCHECKED}
  ${Else}
    ${NSD_SetState} $AnchovyExplorerCheckbox ${BST_CHECKED}
  ${EndIf}
FunctionEnd

Function AnchovyWelcomeLeave
  ${NSD_GetState} $AnchovyExplorerCheckbox $AnchovyExplorerIntegration
FunctionEnd

!macro AnchovyAudioType EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${ANCHOVY_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ANCHOVY_VERB}" "" "${ANCHOVY_VERB_LABEL}"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ANCHOVY_VERB}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ANCHOVY_VERB}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro AnchovyRemoveAudioType EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${ANCHOVY_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ANCHOVY_VERB}"
!macroend

!macro AnchovyForEachAudioType MACRO
  !insertmacro ${MACRO} "wav"
  !insertmacro ${MACRO} "wave"
  !insertmacro ${MACRO} "aif"
  !insertmacro ${MACRO} "aiff"
  !insertmacro ${MACRO} "aifc"
  !insertmacro ${MACRO} "caf"
  !insertmacro ${MACRO} "mp3"
  !insertmacro ${MACRO} "mp2"
  !insertmacro ${MACRO} "mp1"
  !insertmacro ${MACRO} "ogg"
  !insertmacro ${MACRO} "oga"
  !insertmacro ${MACRO} "opus"
  !insertmacro ${MACRO} "flac"
  !insertmacro ${MACRO} "m4a"
  !insertmacro ${MACRO} "m4b"
  !insertmacro ${MACRO} "aac"
  !insertmacro ${MACRO} "mka"
!macroend

!macro AnchovyFolderVerb KEY ARGUMENT
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${ANCHOVY_VERB}" "" "${ANCHOVY_VERB_LABEL}"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${ANCHOVY_VERB}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${ANCHOVY_VERB}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "${ARGUMENT}"'
!macroend

!macro AnchovyRegisterExplorer
  ; The ProgID the "Open with" entries point to.
  WriteRegStr SHCTX "Software\Classes\${ANCHOVY_PROGID}" "" "Audio file"
  WriteRegStr SHCTX "Software\Classes\${ANCHOVY_PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${ANCHOVY_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "Anchovy Player"
  !insertmacro AnchovyForEachAudioType AnchovyAudioType
  ; %1 is the folder clicked on; %V is the folder whose empty space was clicked.
  !insertmacro AnchovyFolderVerb "Directory" "%1"
  !insertmacro AnchovyFolderVerb "Directory\Background" "%V"
!macroend

!macro AnchovyRemoveExplorer
  !insertmacro AnchovyForEachAudioType AnchovyRemoveAudioType
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\${ANCHOVY_VERB}"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\${ANCHOVY_VERB}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\Classes\${ANCHOVY_PROGID}"
!macroend

!macro AnchovyNotifyExplorer
  ; SHCNE_ASSOCCHANGED: Explorer re-reads associations without a restart.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $AnchovyExplorerIntegration == ${BST_UNCHECKED}
    ; Reinstalling with the box cleared removes what an earlier install added.
    !insertmacro AnchovyRemoveExplorer
  ${Else}
    !insertmacro AnchovyRegisterExplorer
  ${EndIf}
  !insertmacro AnchovyNotifyExplorer
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AnchovyRemoveExplorer
  !insertmacro AnchovyNotifyExplorer
!macroend
