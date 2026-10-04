(function () {
    const styleSheetId = "skip-polyfill-pl-body-html";
    if (window.innerWidth <= 480 && !document.getElementById(styleSheetId)) {
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = `header{width:100%;max-width:100vw;overflow-x:hidden;}.flex-1{min-width:0;}`;
        styleSheet.id = styleSheetId;
        document.head.appendChild(styleSheet);
    }
})();
