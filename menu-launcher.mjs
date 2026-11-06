/**
 * Adds non-floating entry points to SillyTavern's extension (wand) menu and
 * extension menu. No duplicate launcher is inserted into extension settings.
 */
export const MENU_ENTRY_ID='abop-extension-menu-entry';
export const SETTINGS_ENTRY_ID='abop-extension-settings-entry';

/** @param {Document} doc @param {()=>void} openPanel */
export function mountExtensionLaunchers(doc,openPanel){
 const menu=doc.getElementById('extensionsMenu');
 if(menu&&!doc.getElementById(MENU_ENTRY_ID)){
  const entry=doc.createElement('div');
  entry.id=MENU_ENTRY_ID;
  entry.className='list-group-item flex-container flexGap5';
  entry.setAttribute('role','button');
  entry.setAttribute('tabindex','0');
  entry.setAttribute('aria-label','Открыть «Дела того дня»');
  entry.title='Открыть состояние, начальный анализ и настройки «Дел того дня»';
  const glyph=doc.createElement('span');
  glyph.className='fa-solid fa-heart-pulse extensionsMenuExtensionButton';
  glyph.setAttribute('aria-hidden','true');
  const name=doc.createElement('span');
  name.textContent='Дела того дня';
  entry.append(glyph,name);
  entry.addEventListener('click',openPanel);
  entry.addEventListener('keydown',event=>{
   if(event.key!=='Enter'&&event.key!==' ')return;
   event.preventDefault();openPanel();
  });
  menu.appendChild(entry);
 }
 // Remove the redundant settings-area launcher, including one left by a previous version.
 doc.getElementById(SETTINGS_ENTRY_ID)?.remove();
 return {menu:!!menu,settings:true};
}
