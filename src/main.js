import { createApp } from './vue.esm-browser.js';
import FontName from './fontname.js';

const { message, confirm, open } = window.__TAURI__.dialog;
const { appLocalDataDir } = window.__TAURI__.path;
const { readBinaryFile, writeTextFile, createDir, BaseDirectory } = window.__TAURI__.fs;
const { Command, open: shellOpen } = window.__TAURI__.shell;
const { listen } = window.__TAURI__.event;

function arrayBufferToBase64(buffer, type, callback) {
  const blob = new Blob([buffer], { type });
  const reader = new FileReader();
  reader.onload = (e) => {
    callback(e.target.result);
  };
  reader.readAsDataURL(blob);
}

// document.addEventListener('contextmenu', e => e.preventDefault());

createApp({
  data() {
    return {
      characters:  '',
      types: ['original', 'woff', 'woff2', 'css'],
      filePath: '',
      loading: false,
      ...JSON.parse(localStorage.getItem('config')),
    }
  },
  mounted() {
    listen('tauri://file-drop', (event) => {
      const filePath = event.payload.find(path => path.endsWith('.otf') || path.endsWith('.ttf'));

      if (filePath) {
        this.loadFile(filePath);
      }
    });

    new Command('pyftsubset').execute().catch((reason) => {
      message(reason, { title: 'command not found: pyftsubset ', type: 'warning' });
    });

    if (this.filePath) {
      this.loadFile(this.filePath);
    }
  },
  methods: {
    async loadFile(filePath) {    
      console.log(filePath);

      const fileType = filePath.endsWith('ttf') ? 'truetype' : 'opentype';
      let contents;

      this.loading = true;

      try {
        contents = await readBinaryFile(filePath);
      } catch (e) {
        console.log(e);
        this.filePath = '';
        return;
      } finally {
        this.loading = false;
      }

      try {
        this.fontMeta = FontName.parse(contents)[0];
        console.log(this.fontMeta);
      } catch (e) {
        console.log(e);
        this.fontMeta = null;
      }
  
      arrayBufferToBase64(
        contents,
        `application/x-font-${fileType}`,
        (dataUrl) => {
          const css = `
          @font-face {
            font-family: "UserSelectedFont";
            font-style: normal;
            font-weight: normal;
            src: url(${dataUrl}) format("${fileType}");
          }
          `;
    
          document.getElementById('font-css').textContent = css;

          this.filePath = filePath;

          const localCharacters = localStorage.getItem(filePath);

          if (localCharacters && this.characters !== localCharacters) {
            confirm('Do you want to load the last characters used by the font?').then((confirmed) => {
              if (confirmed) {
                this.characters = localCharacters;
              }
            });
          }
        }
      );
    },
    async handlePick() {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Font',
          extensions: ['otf', 'ttf'],
        }],
      });

      if (!selected) return;

      this.loadFile(selected);
    },
    async handleSubmit() {
      const characters = this.characters.replace(/\r|\n/g, '');
      const { filePath, fileName, types } = this;
      const fileExt = fileName.split('.').pop();
      const folderName = `${fileName.split('.')[0]}_${Date.now()}`;
      
      await createDir(folderName, { dir: BaseDirectory.AppLocalData, recursive: true });
      
      const folderPath = `${await appLocalDataDir()}${folderName}`;
      
      if (!filePath) {
        message('Please choose a file.', { type: 'error' });
        return;
      }
      
      if (!types.length) {
        message('Choose at least one format.', { type: 'error' });
        return;
      }

      const fileNameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));
      const promises = [];

      types.forEach((type) => {
        switch (type) {
          case 'original':
            promises.push(new Command('pyftsubset', [filePath, `--text=${characters}`, `--output-file=${folderPath}/${fileNameWithoutExt}.subset.${fileExt}`]).execute());
            break
          case 'woff':
            promises.push(new Command('pyftsubset', [filePath, `--text=${characters}`, '--flavor=woff', `--output-file=${folderPath}/${fileNameWithoutExt}.subset.woff`]).execute());
            break;
          case 'woff2':
            promises.push(new Command('pyftsubset', [filePath, `--text=${characters}`, '--flavor=woff2', `--output-file=${folderPath}/${fileNameWithoutExt}.subset.woff2`]).execute());
            break;
          case 'css':
            const srcList = [];

            if (this.fontMeta) srcList.push(`local("${this.fontMeta.fontFamily}")`);
            if (types.includes('original')) srcList.push(`url("${fileNameWithoutExt}.subset.${fileExt}") format("${filePath.endsWith('ttf') ? 'truetype' : 'opentype'}")`);
            if (types.includes('woff')) srcList.push(`url("${fileNameWithoutExt}.subset.woff") format("woff")`);
            if (types.includes('woff2')) srcList.push(`url("${fileNameWithoutExt}.subset.woff2") format("woff2")`);

            const text = `@font-face {
  font-family: "${this.fontMeta?.fontFamily || fileName.split('.')[0]}";
  font-style: normal;
  font-weight: normal;
  src: ${srcList.join(',\n       ')};
}`;
            promises.push(writeTextFile(`${folderName}/${fileNameWithoutExt}.css`, text, { dir: BaseDirectory.AppLocalData }));
            break;
        }
      });

      Promise.all(promises)
        .then((results) => {
          console.log(results);

          const errors = results.filter(r => r && r.code !== 0);
      
          if (errors.length) {
            message(errors[0].stderr, { title: `Failed: ${errors.length} / Success: ${results.length - errors.length}`, type: 'error' });
          }

          shellOpen(folderPath);

          localStorage.setItem(filePath, this.characters);
        })
        .catch((reason) => {
          message(reason, { type: 'error' });
        });
    },
    saveConfig() {
      localStorage.setItem('config', JSON.stringify({
        characters: this.characters,
        types: this.types,
        filePath: this.filePath,
      }));
    },
  },
  computed: {
    fileName() {
      return this.filePath ? this.filePath.split('/').pop() : '';
    },
  },
  watch: {
    characters: 'saveConfig',
    types: 'saveConfig',
    filePath: 'saveConfig',
  },
}).mount('#app');
