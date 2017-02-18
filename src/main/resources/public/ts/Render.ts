console.log("Render.ts");

import { meta64 } from "./Meta64"
import { util } from "./Util";
import { nav } from "./Nav";
import { edit } from "./Edit";
import { view } from "./View";
import { cnst, jcrCnst } from "./Constants";
import { props } from "./Props";
import * as I from "./Interfaces"
import { Factory } from "./Factory";
import { MessageDlg } from "./MessageDlg";
import { tag } from "./Tag";

declare var postTargetUrl;
declare var prettyPrint;

export class Render {
    private debug: boolean = false;

    /*
     * This is the content displayed when the user signs in, and we see that they have no content being displayed. We
     * want to give them some instructions and the ability to add content.
     */
    private getEmptyPagePrompt = function(): string {
        return "<p>There are no subnodes under this node. <br><br>Click 'EDIT MODE' and then use the 'ADD' button to create content.</p>";
    }

    private renderBinary = function(node: I.NodeInfo): string {
        /*
         * If this is an image render the image directly onto the page as a visible image
         */
        if (node.binaryIsImage) {
            return render.makeImageTag(node);
        }
        /*
         * If not an image we render a link to the attachment, so that it can be downloaded.
         */
        else {
            let anchor: string = tag.a({
                "href": render.getUrlForNodeAttachment(node)
            }, "[Download Attachment]");

            return tag.div({
                "class": "binary-link"
            }, anchor);
        }
    }

    /*
     * Important little method here. All GUI page/divs are created using this sort of specification here that they
     * all must have a 'build' method that is called first time only, and then the 'init' method called before each
     * time the component gets displayed with new information.
     *
     * If 'data' is provided, this is the instance data for the dialog
     */
    buidPage = function(pg, data): void {
        console.log("buildPage: pg.domId=" + pg.domId);

        if (!pg.built || data) {
            pg.render(data);
            pg.built = true;
        }

        if (pg.init) {
            pg.init(data);
        }
    }

    buildRowHeader = function(node: I.NodeInfo, showPath: boolean, showName: boolean): string {
        let commentBy: string = props.getNodePropertyVal(jcrCnst.COMMENT_BY, node);

        let headerText: string = "";

        if (cnst.SHOW_PATH_ON_ROWS) {
            headerText += tag.div({
                "class": "path-display"
            },
                "Path: " + render.formatPath(node));
        }

        let spans: string = "";
        if (commentBy) {
            let clazz: string = (commentBy === meta64.userName) ? "created-by-me" : "created-by-other";
            spans += tag.span({
                "class": clazz
            },
                "Comment By: " + commentBy);
        } //
        else if (node.createdBy) {
            let clazz: string = (node.createdBy === meta64.userName) ? "created-by-me" : "created-by-other";
            spans += tag.span({
                "class": clazz
            },
                "Created By: " + node.createdBy);
        }

        spans += tag.span({ "id": `ownerDisplay${node.uid}` });
        if (node.lastModified) {
            spans += `  Mod: ${node.lastModified}`;
        }

        headerText += tag.div("null", spans);

        /*
         * on root node name will be empty string so don't show that
         *
         * commenting: I decided users will understand the path as a single long entity with less confusion than
         * breaking out the name for them. They already unserstand internet URLs. This is the same concept. No need
         * to baby them.
         *
         * The !showPath condition here is because if we are showing the path then the end of that is always the
         * name, so we don't need to show the path AND the name. One is a substring of the other.
         */
        if (showName && !showPath && node.name) {
            headerText += `Name: ${node.name} [uid=${node.uid}]`;
        }

        headerText = tag.div({
            "class": "header-text"
        }, headerText);

        return headerText;
    }

    /*
     * Pegdown markdown processor will create <code> blocks and the class if provided, so in order to get google
     * prettifier to process it the rest of the way (when we call prettyPrint() for the whole page) we now run
     * another stage of transformation to get the <pre> tag put in with 'prettyprint' etc.
     */
    injectCodeFormatting = function(content: string): string {
        if (!content) return content;
        // example markdown:
        // ```js
        // var x = 10;
        // var y = "test";
        // ```
        //
        if (util.contains(content, "<code")) {
            meta64.codeFormatDirty = true;
            content = render.encodeLanguages(content);
            content = util.replaceAll(content, "</code>", "</pre>");
        }

        return content;
    }

    injectSubstitutions = function(content: string): string {
        return util.replaceAll(content, "{{locationOrigin}}", window.location.origin);
    }

    encodeLanguages = function(content: string): string {
        /*
         * todo-1: need to provide some way of having these language types configurable in a properties file
         * somewhere, and fill out a lot more file types.
         */
        let langs = ["js", "html", "htm", "css"];
        for (let i = 0; i < langs.length; i++) {
            content = util.replaceAll(content, "<code class=\"" + langs[i] + "\">", //
                "<?prettify lang=" + langs[i] + "?><pre class='prettyprint'>");
        }
        content = util.replaceAll(content, "<code>", "<pre class='prettyprint'>");

        return content;
    }

    /* after a property, or node is updated (saved) we can now call this method instead of refreshing the entire page
    which is what's done in most of the app, which is much less efficient and snappy visually */
    refreshNodeOnPage = function(node: I.NodeInfo): void {
        //need to lookup uid from NodeInfo.id then set the content of this div.
        //"id": uid + "_content"
        //to the value from renderNodeContent(node, true, true, true, true, true)));
        let uid: string = meta64.identToUidMap[node.id];
        if (!uid) throw `Unable to find nodeId ${node.id} in uid map`;
        meta64.initNode(node, false);
        if (uid != node.uid) throw "uid changed unexpectly after initNode";
        let rowContent: string = render.renderNodeContent(node, true, true, true, true, true);
        util.setInnerHTMLById(uid + "_content", rowContent);
    }

    //
    /*
     * This is the function that renders each node in the main window. The rendering in here is very central to the
     * app and is what the user sees covering 90% of the screen most of the time. The "content* nodes.
     *
     * todo-0: Rather than having this node renderer itself be responsible for rendering all the different types
     * of nodes, need a more pluggable design, where rendeing of different things is deletaged to some
     * appropriate object/service
     */
    renderNodeContent = function(node: I.NodeInfo, showPath, showName, renderBin, rowStyling, showHeader): string {
        var ret: string = render.getTopRightImageTag(node);

        /* todo-2: enable headerText when appropriate here */
        if (meta64.showMetaData) {
            ret += showHeader ? render.buildRowHeader(node, showPath, showName) : "";
        }

        if (meta64.showProperties) {
            var properties = props.renderProperties(node.properties);
            if (properties) {
                ret += /* "<br>" + */properties;
            }
        } else {
            let renderComplete: boolean = false;

            /*
             * Special Rendering for Nodes that have a plugin-renderer
             */
            if (!renderComplete) {
                let func: Function = meta64.renderFunctionsByJcrType[node.primaryTypeName];
                if (func) {
                    renderComplete = true;
                    ret += func(node, rowStyling)
                }
            }

            if (!renderComplete) {
                let contentProp: I.PropertyInfo = props.getNodeProperty(jcrCnst.CONTENT, node);

                //console.log("contentProp: " + contentProp);
                if (contentProp) {
                    renderComplete = true;

                    let jcrContent = props.renderProperty(contentProp);
                    //console.log("**************** jcrContent for MARKDOWN:\n"+jcrContent);

                    let markedContent = "<marked-element sanitize='true'>" +
                        tag.div({ "class": "markdown-html" }) +
                        "<script type='text/markdown'>\n" +
                        jcrContent +
                        "</script>" +
                        "</marked-element>";

                    //not w-pack
                    //When doing server-side markdown we had this processing the HTML that was generated
                    //but I haven't looked into how to get this back now that we are doing markdown on client.
                    //jcrContent = injectCodeFormatting(jcrContent);
                    //jcrContent = injectSubstitutions(jcrContent);

                    if (rowStyling) {
                        ret += tag.div({
                            "class": "jcr-content"
                        }, markedContent);
                    } else {
                        ret += tag.div({
                            "class": "jcr-root-content"
                        }, markedContent);
                    }
                }
            }

            if (!renderComplete) {
                if (node.path.trim() == "/") {
                    ret += "Root Node";
                }
                /* ret += "< div>[No Content Property]</div>"; */
                let properties: string = props.renderProperties(node.properties);
                if (properties) {
                    ret += /* "<br>" + */properties;
                }
            }
        }

        if (renderBin && node.hasBinary) {
            let binary: string = render.renderBinary(node);

            /*
             * We append the binary image or resource link either at the end of the text or at the location where
             * the user has put {{insert-attachment}} if they are using that to make the image appear in a specific
             * locatio in the content text.
             */
            if (util.contains(ret, cnst.INSERT_ATTACHMENT)) {
                ret = util.replaceAll(ret, cnst.INSERT_ATTACHMENT, binary);
            } else {
                ret += binary;
            }
        }

        let tags: string = props.getNodePropertyVal(jcrCnst.TAGS, node);
        if (tags) {
            ret += tag.div({
                "class": "tags-content"
            }, "Tags: " + tags);
        }

        return ret;
    }

    renderJsonFileSearchResultProperty = function(jsonContent: string): string {
        let content: string = "";
        try {
            console.log("json: " + jsonContent);
            let list: any[] = JSON.parse(jsonContent);

            for (let entry of list) {
                content += tag.div({
                    "class": "systemFile",
                    "onclick": `meta64.editSystemFile('${entry.fileName}')`
                }, entry.fileName);

                /* openSystemFile worked on linux, but i'm switching to full text file edit capability only and doing that
                inside meta64 from now on, so openSystemFile is no longer being used */
                //not w-pack
                // let localOpenLink = tag.button({
                //     "raised": "raised",
                //     "onclick": "meta64.openSystemFile('" + entry.fileName + "')"
                // }, "Local Open");
                //
                // let downloadLink = "";
                //haven't implemented download capability yet.
                // tag.button({
                //     "raised": "raised",
                //     "onclick": "meta64.downloadSystemFile('" + entry.fileName + "')"
                // }, "Download")
                // let linksDiv = tag("div", {
                // }, localOpenLink + downloadLink);
                // content += tag("div", {
                // }, fileNameDiv);
            }
        }
        catch (e) {
            util.logAndReThrow("render failed", e);
            content = "[render failed]"
        }
        return content;
    }

    /*
     * This is the primary method for rendering each node (like a row) on the main HTML page that displays node
     * content. This generates the HTML for a single row/node.
     *
     * node is a NodeInfo.java JSON
     */
    renderNodeAsListItem = function(node: I.NodeInfo, index: number, count: number, rowCount: number): string {

        let uid: string = node.uid;
        let prevPageExists: boolean = nav.mainOffset > 0;
        let nextPageExists: boolean = !nav.endReached;
        let canMoveUp: boolean = (index > 0 && rowCount > 1) || prevPageExists;
        let canMoveDown: boolean = (index < count - 1) || nextPageExists;

        let isRep: boolean = util.startsWith(node.name, "rep:") || /*
														 * meta64.currentNodeData. bug?
														 */util.contains(node.path, "/rep:");

        let editingAllowed: boolean = props.isOwnedCommentNode(node);
        if (!editingAllowed) {
            editingAllowed = (meta64.isAdminUser || !isRep) && !props.isNonOwnedCommentNode(node)
                && !props.isNonOwnedNode(node);
        }

        // console.log("Rendering Node Row[" + index + "] editingAllowed="+editingAllowed);

        /*
         * if not selected by being the new child, then we try to select based on if this node was the last one
         * clicked on for this page.
         */
        //not w-pack
        // console.log("test: [" + parentIdToFocusIdMap[currentNodeId]
        // +"]==["+ node.id + "]")
        let focusNode: I.NodeInfo = meta64.getHighlightedNode();
        let selected: boolean = (focusNode && focusNode.uid === uid);

        let buttonBarHtmlRet: string = render.makeRowButtonBarHtml(node, canMoveUp, canMoveDown, editingAllowed);
        let bkgStyle: string = render.getNodeBkgImageStyle(node);

        let cssId: string = "row_" + uid /*+ "_row"*/;
        return tag.div({
            "class": "node-table-row" + (selected ? " active-row" : " inactive-row"),
            "onClick": `meta64.clickOnNodeRow(this, '${uid}');`, //
            "id": cssId,
            "style": bkgStyle
        },//
            buttonBarHtmlRet + tag.div({
                "id": uid + "_content"
            }, render.renderNodeContent(node, true, true, true, true, true)));
    }

    showNodeUrl = function() {
        let node: I.NodeInfo = meta64.getHighlightedNode();
        if (!node) {
            util.showMessage("You must first click on a node.");
            return;
        }

        let path: string = util.stripIfStartsWith(node.path, "/root");
        let url: string = window.location.origin + "?id=" + path;
        meta64.selectTab("mainTabName");

        let message: string = "URL using path: <br>" + url;
        let uuid: string = props.getNodePropertyVal("jcr:uuid", node);
        if (uuid) {
            message += "<p>URL for UUID: <br>" + window.location.origin + "?id=" + uuid;
        }

        util.showMessage(message);
    }

    getTopRightImageTag = function(node: I.NodeInfo) {
        let topRightImg: string = props.getNodePropertyVal('img.top.right', node);
        let topRightImgTag: string = "";
        if (topRightImg) {
            topRightImgTag = render.tag("img", {
                "src": topRightImg,
                "class": "top-right-image"
            }, "", false);
        }
        return topRightImgTag;
    }

    getNodeBkgImageStyle = function(node: I.NodeInfo): string {
        let bkgImg: string = props.getNodePropertyVal('img.node.bkg', node);
        let bkgImgStyle: string = "";
        if (bkgImg) {
            //todo-0: as I was converting some strings to backtick i noticed this URL missing the quotes around the string. Is this a bug?
            bkgImgStyle = `background-image: url(${bkgImg});`;
        }
        return bkgImgStyle;
    }

    centeredButtonBar = function(buttons?: string, classes?: string): string {
        classes = classes || "";

        return tag.div({
            "class": "horizontal center-justified layout vertical-layout-row " + classes
        }, buttons);
    }

    centerContent = function(content: string, width: number): string {
        let div: string = tag.div({ "style": `width:${width}px;` }, content);

        let attrs = {
            "class": "horizontal center-justified layout vertical-layout-row"
        };

        return tag.div(attrs, div);
    }

    buttonBar = function(buttons: string, classes: string): string {
        classes = classes || "";

        return tag.div({
            "class": "horizontal left-justified layout vertical-layout-row " + classes
        }, buttons);
    }

    makeRowButtonBarHtml = function(node: I.NodeInfo, canMoveUp: boolean, canMoveDown: boolean, editingAllowed: boolean) {

        let createdBy: string = props.getNodePropertyVal(jcrCnst.CREATED_BY, node);
        let commentBy: string = props.getNodePropertyVal(jcrCnst.COMMENT_BY, node);
        let publicAppend: string = props.getNodePropertyVal(jcrCnst.PUBLIC_APPEND, node);

        let openButton: string = "";
        let selButton: string = "";
        let createSubNodeButton: string = "";
        let editNodeButton: string = "";
        let moveNodeUpButton: string = "";
        let moveNodeDownButton: string = "";
        let insertNodeButton: string = "";
        let replyButton: string = "";

        /*
         * Show Reply button if this is a publicly appendable node and not created by current user,
         * or having been added as comment by current user
         */
        if (publicAppend && createdBy != meta64.userName && commentBy != meta64.userName) {
            replyButton = tag.button({
                "raised": "raised",
                "onClick": `meta64.replyToComment('${node.uid}');` //
            }, //
                "Reply");
        }

        let buttonCount: number = 0;

        /* Construct Open Button */
        if (render.nodeHasChildren(node.uid)) {
            buttonCount++;

            openButton = tag.button({

                /* For some unknown reason the ability to style this with the class broke, and even
                after dedicating several hours trying to figure out why I'm still baffled. I checked everything
                a hundred times and still don't know what I'm doing wrong...I just finally put the god damn fucking style attribute
                here to accomplish the same thing */
                "style": "background-color: #4caf50;color:white;",
                "raised": "raised",
                "onClick": `meta64.openNode('${node.uid}');`//
            }, //
                "Open");
        }

        /*
         * If in edit mode we always at least create the potential (buttons) for a user to insert content, and if
         * they don't have privileges the server side security will let them know. In the future we can add more
         * intelligence to when to show these buttons or not.
         */
        if (meta64.userPreferences.editMode) {
            // console.log("Editing allowed: " + nodeId);

            let selected: boolean = meta64.selectedNodes[node.uid] ? true : false;

            // console.log(" nodeId " + node.uid + " selected=" + selected);
            buttonCount++;

            let attrs: Object = selected ? {
                "id": node.uid + "_sel",//
                "onClick": `meta64.toggleNodeSel('${node.uid}');`,
                "checked": "checked",
                //padding is a back hack to make checkbox line up with other icons.
                //(i will probably end up using a paper-icon-button that toggles here, instead of checkbox)
                "style": "margin-top: 11px;"
            } : //
                {
                    "id": node.uid + "_sel",//
                    "onClick": `meta64.toggleNodeSel('${node.uid}');`,
                    "style": "margin-top: 11px;"
                };

            selButton = tag.checkbox(attrs);

            if (cnst.NEW_ON_TOOLBAR && !commentBy) {
                /* Construct Create Subnode Button */
                buttonCount++;
                createSubNodeButton = tag.button({
                    "icon": "icons:picture-in-picture-alt", //"icons:more-vert",
                    "id": "addNodeButtonId" + node.uid,
                    "raised": "raised",
                    "onClick": `meta64.createSubNode('${node.uid}');`
                }, "Add");
            }

            if (cnst.INS_ON_TOOLBAR && !commentBy) {
                buttonCount++;
                /* Construct Create Subnode Button */
                insertNodeButton = tag.button({
                    "icon": "icons:picture-in-picture", //"icons:more-horiz",
                    "id": "insertNodeButtonId" + node.uid,
                    "raised": "raised",
                    "onClick": `meta64.insertNode('${node.uid}');`
                }, "Ins");
            }
        }

        //Polmer Icons Reference: https://elements.polymer-project.org/elements/iron-icons?view=demo:demo/index.html

        if (meta64.userPreferences.editMode && editingAllowed) {
            buttonCount++;
            /* Construct Create Subnode Button */
            editNodeButton = tag.button({
                "alt": "Edit node.",
                "icon": "editor:mode-edit",
                "raised": "raised",
                "onClick": `meta64.runEditNode('${node.uid}');`
            }, "Edit");

            if (cnst.MOVE_UPDOWN_ON_TOOLBAR && meta64.currentNode.childrenOrdered && !commentBy) {

                if (canMoveUp) {
                    buttonCount++;
                    /* Construct Create Subnode Button */
                    moveNodeUpButton = tag.button({
                        "icon": "icons:arrow-upward",
                        "raised": "raised",
                        "onClick": `meta64.moveNodeUp('${node.uid}');`
                    }, "Up");
                }

                if (canMoveDown) {
                    buttonCount++;
                    /* Construct Create Subnode Button */
                    moveNodeDownButton = tag.button({
                        "icon": "icons:arrow-downward",
                        "raised": "raised",
                        "onClick": `meta64.moveNodeDown('${node.uid}');`
                    }, "Dn");
                }
            }
        }

        /*
         * i will be finding a reusable/DRY way of doing tooltops soon, this is just my first experiment.
         *
         * However tooltips ALWAYS cause problems. Mystery for now.
         */
        let insertNodeTooltip: string = "";
        //not w-pack
        //			 tag("paper-tooltip", {
        //			 "for" : "insertNodeButtonId" + node.uid
        //			 }, "INSERTS a new node at the current tree position. As a sibling on this level.");

        let addNodeTooltip: string = "";

        //not w-pack
        //			 tag("paper-tooltip", {
        //			 "for" : "addNodeButtonId" + node.uid
        //			 }, "ADDS a new node inside the current node, as a child of it.");

        let allButtons: string = selButton + openButton + insertNodeButton + createSubNodeButton + insertNodeTooltip
            + addNodeTooltip + editNodeButton + moveNodeUpButton + moveNodeDownButton + replyButton;

        return allButtons.length > 0 ? render.makeHorizontalFieldSet(allButtons, "row-toolbar") : "";
    }

    makeHorizontalFieldSet = function(content?: string, extraClasses?: string): string {

        /* Now build entire control bar */
        return tag.div( //
            {
                "class": "horizontal layout" + (extraClasses ? (" " + extraClasses) : "")
            }, content);
    }

    makeHorzControlGroup = function(content: string): string {
        return tag.div({
            "class": "horizontal layout"
        }, content);
    }

    makeRadioButton = function(label: string, id: string): string {
        return tag.radioButton({
            "id": id,
            "name": id
        }, label);
    }

    /*
     * Returns true if the nodeId (see makeNodeId()) NodeInfo object has 'hasChildren' true
     */
    nodeHasChildren = function(uid: string): boolean {
        var node: I.NodeInfo = meta64.uidToNodeMap[uid];
        if (!node) {
            console.log("Unknown nodeId in nodeHasChildren: " + uid);
            return false;
        } else {
            return node.hasChildren;
        }
    }

    formatPath = function(node: I.NodeInfo): string {
        let path: string = node.path;

        /* we inject space in here so this string can wrap and not affect window sizes adversely, or need scrolling */
        path = util.replaceAll(path, "/", " / ");
        let shortPath: string = path.length < 50 ? path : path.substring(0, 40) + "...";

        let noRootPath: string = shortPath;
        if (util.startsWith(noRootPath, "/root")) {
            noRootPath = noRootPath.substring(0, 5);
        }

        let ret: string = meta64.isAdminUser ? shortPath : noRootPath;
        ret += " [" + node.primaryTypeName + "]";
        return ret;
    }

    /*
     * Renders page and always also takes care of scrolling to selected node if there is one to scroll to
     */
    renderPageFromData = function(data?: I.RenderNodeResponse, scrollToTop?: boolean): string {
        meta64.codeFormatDirty = false;
        console.log("render.renderPageFromData()");

        let newData: boolean = false;
        if (!data) {
            data = meta64.currentNodeData;
        } else {
            newData = true;
        }

        nav.endReached = data && data.endReached;

        if (!data || !data.node) {
            util.setElmDisplayById("listView", false);
            util.setInnerHTMLById("mainNodeContent", "No content is available here.");
            return;
        } else {
            util.setElmDisplayById("listView", true);
        }

        meta64.treeDirty = false;

        if (newData) {
            meta64.uidToNodeMap = {};
            meta64.idToNodeMap = {};
            meta64.identToUidMap = {};

            /*
             * I'm choosing to reset selected nodes when a new page loads, but this is not a requirement. I just
             * don't have a "clear selections" feature which would be needed so user has a way to clear out.
             */
            meta64.selectedNodes = {};
            meta64.parentUidToFocusNodeMap = {};

            meta64.initNode(data.node, true);
            meta64.setCurrentNodeData(data);
        }

        let propCount: number = meta64.currentNode.properties ? meta64.currentNode.properties.length : 0;

        if (render.debug) {
            console.log("RENDER NODE: " + data.node.id + " propCount=" + propCount);
        }

        let output: string = "";
        let bkgStyle: string = render.getNodeBkgImageStyle(data.node);

        /*
         * NOTE: mainNodeContent is the parent node of the page content, and is always the node displayed at the to
         * of the page above all the other nodes which are its child nodes.
         */
        let mainNodeContent: string = render.renderNodeContent(data.node, true, true, true, false, true);

        //console.log("mainNodeContent: "+mainNodeContent);

        if (mainNodeContent.length > 0) {
            let uid: string = data.node.uid;
            let cssId: string = "row_" + uid /*+ "_row"*/;
            let buttonBar: string = "";
            let editNodeButton: string = "";
            let createSubNodeButton: string = "";
            let replyButton: string = "";

            // console.log("data.node.path="+data.node.path);
            // console.log("isNonOwnedCommentNode="+props.isNonOwnedCommentNode(data.node));
            // console.log("isNonOwnedNode="+props.isNonOwnedNode(data.node));

            let createdBy: string = props.getNodePropertyVal(jcrCnst.CREATED_BY, data.node);
            let commentBy: string = props.getNodePropertyVal(jcrCnst.COMMENT_BY, data.node);
            let publicAppend: string = props.getNodePropertyVal(jcrCnst.PUBLIC_APPEND, data.node);

            /*
             * Show Reply button if this is a publicly appendable node and not created by current user,
             * or having been added as comment by current user
             */

            if (publicAppend && createdBy != meta64.userName && commentBy != meta64.userName) {
                replyButton = tag.button({
                    "raised": "raised",
                    "onClick": `meta64.replyToComment('${data.node.uid}');` //
                }, //
                    "Reply");
            }

            if (meta64.userPreferences.editMode && cnst.NEW_ON_TOOLBAR && edit.isInsertAllowed(data.node)) {
                createSubNodeButton = tag.button({
                    "icon": "icons:picture-in-picture-alt", //icons:more-vert",
                    "raised": "raised",
                    "onClick": `meta64.createSubNode('${uid}');`
                }, "Add");
            }

            /* Add edit button if edit mode and this isn't the root */
            if (edit.isEditAllowed(data.node)) {

                /* Construct Create Subnode Button */
                editNodeButton = tag.button({
                    "icon": "editor:mode-edit",
                    "raised": "raised",
                    "onClick": `meta64.runEditNode('${uid}');`
                }, "Edit");
            }

            /* Construct Create Subnode Button */
            let focusNode: I.NodeInfo = meta64.getHighlightedNode();
            let selected: boolean = focusNode && focusNode.uid === uid;

            //not w-pack
            // var rowHeader = buildRowHeader(data.node, true, true);

            if (createSubNodeButton || editNodeButton || replyButton) {
                buttonBar = render.makeHorizontalFieldSet(createSubNodeButton + editNodeButton + replyButton);
            }

            let content: string = tag.div({
                "class": (selected ? "mainNodeContentStyle active-row" : "mainNodeContentStyle inactive-row"),
                "onClick": `meta64.clickOnNodeRow(this, '${uid}');`,
                "id": cssId
            },//
                buttonBar + mainNodeContent);

            util.setElmDisplayById("mainNodeContent", true);
            util.setInnerHTMLById("mainNodeContent", content);
        } else {
            util.setElmDisplayById("mainNodeContent", false);
        }

        // console.log("update status bar.");
        view.updateStatusBar();

        if (nav.mainOffset > 0) {
            let firstButton: string = render.makeButton("First Page", "firstPageButton", render.firstPage);
            let prevButton: string = render.makeButton("Prev Page", "prevPageButton", render.prevPage);
            output += render.centeredButtonBar(firstButton + prevButton, "paging-button-bar");
        }

        let rowCount: number = 0;
        if (data.children) {
            let childCount: number = data.children.length;
            // console.log("childCount: " + childCount);
            /*
             * Number of rows that have actually made it onto the page to far. Note: some nodes get filtered out on
             * the client side for various reasons.
             */
            for (let i = 0; i < data.children.length; i++) {
                let node: I.NodeInfo = data.children[i];
                if (!edit.nodesToMoveSet[node.id]) {
                    let row: string = render.generateRow(i, node, newData, childCount, rowCount);
                    if (row.length != 0) {
                        output += row;
                        rowCount++;
                    }
                }
            }
        }

        if (edit.isInsertAllowed(data.node)) {
            if (rowCount == 0 && !meta64.isAnonUser) {
                output = render.getEmptyPagePrompt();
            }
        }

        if (!data.endReached) {
            let nextButton = render.makeButton("Next Page", "nextPageButton", render.nextPage);
            let lastButton = render.makeButton("Last Page", "lastPageButton", render.lastPage);
            output += render.centeredButtonBar(nextButton + lastButton, "paging-button-bar");
        }

        util.setHtml("listView", output);

        if (meta64.codeFormatDirty) {
            prettyPrint();
        }

        util.forEachElmBySel("a", function(el, i) {
            el.setAttribute("target", "_blank");
        });

        /*
         * TODO-3: Instead of calling screenSizeChange here immediately, it would be better to set the image sizes
         * exactly on the attributes of each image, as the HTML text is rendered before we even call
         * setHtml, so that images always are GUARANTEED to render correctly immediately.
         */
        meta64.screenSizeChange();

        if (scrollToTop || !meta64.getHighlightedNode()) {
            view.scrollToTop();
        } else {
            view.scrollToSelectedNode();
        }
    }

    firstPage = function(): void {
        console.log("First page button click.");
        view.firstPage();
    }

    prevPage = function(): void {
        console.log("Prev page button click.");
        view.prevPage();
    }

    nextPage = function(): void {
        console.log("Next page button click.");
        view.nextPage();
    }

    lastPage = function(): void {
        console.log("Last page button click.");
        view.lastPage();
    }

    generateRow = function(i: number, node: I.NodeInfo, newData: boolean, childCount: number, rowCount: number): string {

        if (meta64.isNodeBlackListed(node))
            return "";

        if (newData) {
            meta64.initNode(node, true);

            if (render.debug) {
                console.log(" RENDER ROW[" + i + "]: node.id=" + node.id);
            }
        }

        rowCount++; // warning: this is the local variable/parameter
        let row = render.renderNodeAsListItem(node, i, childCount, rowCount);
        // console.log("row[" + rowCount + "]=" + row);
        return row;
    }

    getUrlForNodeAttachment = function(node: I.NodeInfo): string {
        return postTargetUrl + "bin/file-name?nodeId=" + encodeURIComponent(node.path) + "&ver=" + node.binVer;
    }

    /* see also: makeImageTag() */
    adjustImageSize = function(node: I.NodeInfo): void {

        let elm: HTMLElement = util.domElm(node.imgId);
        if (elm) {
            // let width = elm.attr("width");
            // let height = elm.attr("height");
            // console.log("width=" + width + " height=" + height);

            if (node.width && node.height) {

                /*
                 * New Logic is try to display image at 150% meaning it can go outside the content div it's in,
                 * which we want, but then we also limit it with max-width so on smaller screen devices or small
                 * window resizings even on desktop browsers the image will always be entirely visible and not
                 * clipped.
                 */
                // let maxWidth = meta64.deviceWidth - 80;
                // elm.attr("width", "150%");
                // elm.attr("height", "auto");
                // elm.attr("style", "max-width: " + maxWidth + "px;");
                /*
                 * DO NOT DELETE (for a long time at least) This is the old logic for resizing images responsively,
                 * and it works fine but my new logic is better, with limiting max width based on screen size. But
                 * keep this old code for now..
                 */
                if (node.width > meta64.deviceWidth - 80) {

                    /* set the width we want to go for */
                    // let width = meta64.deviceWidth - 80;
                    /*
                     * and set the height to the value it needs to be at for same w/h ratio (no image stretching)
                     */
                    // let height = width * node.height / node.width;
                    elm.setAttribute("width", "100%");
                    elm.setAttribute("height", "auto");
                    // elm.attr("style", "max-width: " + maxWidth + "px;");
                }
                /*
                 * Image does fit on screen so render it at it's exact size
                 */
                else {
                    elm.setAttribute("width", "" + node.width);
                    elm.setAttribute("height", "" + node.height);
                }
            }
        }
    }

    /* see also: adjustImageSize() */
    makeImageTag = function(node: I.NodeInfo) {
        let src: string = render.getUrlForNodeAttachment(node);
        node.imgId = "imgUid_" + node.uid;

        if (node.width && node.height) {

            /*
             * if image won't fit on screen we want to size it down to fit
             *
             * Yes, it would have been simpler to just use something like width=100% for the image width but then
             * the hight would not be set explicitly and that would mean that as images are loading into the page,
             * the effective scroll position of each row will be increasing each time the URL request for a new
             * image completes. What we want is to have it so that once we set the scroll position to scroll a
             * particular row into view, it will stay the correct scroll location EVEN AS the images are streaming
             * in asynchronously.
             *
             */
            if (node.width > meta64.deviceWidth - 50) {

                /* set the width we want to go for */
                let width: number = meta64.deviceWidth - 50;

                /*
                 * and set the height to the value it needs to be at for same w/h ratio (no image stretching)
                 */
                let height: number = width * node.height / node.width;

                return tag.img({
                    "src": src,
                    "id": node.imgId,
                    "width": width + "px",
                    "height": height + "px"
                });
            }
            /* Image does fit on screen so render it at it's exact size */
            else {
                return tag.img({
                    "src": src,
                    "id": node.imgId,
                    "width": node.width + "px",
                    "height": node.height + "px"
                });
            }
        } else {
            return tag.img({
                "src": src,
                "id": node.imgId
            });
        }
    }

    /*
     * creates HTML tag with all attributes/values specified in attributes object, and closes the tag also if
     * content is non-null
     */
    tag = function(tag: string, attributes?: Object, content?: string, closeTag?: boolean): string {

        /* default parameter values */
        if (typeof (closeTag) === 'undefined')
            closeTag = true;

        /* HTML tag itself */
        let ret: string = "<" + tag;

        if (attributes) {
            ret += " ";
            util.forEachProp(attributes, function(k, v) {
                if (v) {
                    if (typeof v !== 'string') {
                        v = String(v);
                    }

                    /*
                     * we intelligently wrap strings that contain single quotes in double quotes and vice versa
                     */
                    if (util.contains(v, "'")) {
                        ret += `${k}="${v}" `;
                    } else {
                        ret += `${k}='${v}' `;
                    }
                } else {
                    ret += k + " ";
                }
            });
        }

        if (closeTag) {
            if (!content) {
                content = "";
            }

            ret += `>${content}</${tag}>`;
        } else {
            ret += "/>";
        }

        return ret;
    }

    makeTextArea = function(fieldName: string, fieldId: string): string {
        return tag.textarea({
            "name": fieldId,
            "label": fieldName,
            "id": fieldId
        });
    }

    makeEditField = function(fieldName: string, fieldId: string): string {
        return tag.input({
            "name": fieldId,
            "label": fieldName,
            "id": fieldId
        });
    }

    makePasswordField = function(fieldName: string, fieldId: string): string {
        return tag.input({
            "type": "password",
            "name": fieldId,
            "label": fieldName,
            "id": fieldId,
            "class": "meta64-input"
        });
    }

    makeButton = function(text: string, id: string, callback: any, ctx?: any): string {
        let attribs = {
            "raised": "raised",
            "id": id,
            "class": "standardButton"
        };

        if (callback != undefined) {
            attribs["onClick"] = meta64.encodeOnClick(callback, ctx);
        }

        return tag.button(attribs, text);
    }

    allowPropertyToDisplay = function(propName: string): boolean {
        if (!meta64.inSimpleMode())
            return true;
        return meta64.simpleModePropertyBlackList[propName] == null;
    }

    isReadOnlyProperty = function(propName: string): boolean {
        return meta64.readOnlyPropertyList[propName];
    }

    isBinaryProperty = function(propName: string): boolean {
        return meta64.binaryPropertyList[propName];
    }

    sanitizePropertyName = function(propName: string): string {
        if (meta64.editModeOption === "simple") {
            return propName === jcrCnst.CONTENT ? "Content" : propName;
        } else {
            return propName;
        }
    }
}
export let render: Render = new Render();
export default render;