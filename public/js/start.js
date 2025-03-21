'use strict';

//const vConsole = new VConsole();
//const remoteConsole = new RemoteConsole("http://[remote server]/logio-post");
//window.datgui = new dat.GUI();

const defaultDataLabel = "dataLabel";
const configName_clientId = "webrtc_clientId";
const configName_channelId = "webrtc_channelId";
const configName_password = "webrtc_password";
var tracks = [];

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    store: vue_store,
    router: vue_router,
    data: {
        param_select: {
            selectingRole: "slave",
            localstream_type: ""
        },
        dataLabel: defaultDataLabel,
        has_displaymedia: false,
        selectingRemoteClientList: [],
        remoteClientList: [],
        selectedRemoteClient: null,
        currentRole: null,
        currentChannelId: null,
        currentRemoteClient: {},
        currentClientId: null,
        dataMessage: "",
        dataMessageLog: "",
        clientList: []
    },
    computed: {
    },
    methods: {
        select_role: async function(){
            try{
                await this.attach_video(this.param_select.localstream_type);

                this.dialog_close("#select_role_dialog");

                this.currentRole = this.param_select.selectingRole;
                this.currentChannelId = this.param_select.channelId;
                this.currentClientId = this.param_select.clientId;

                if( this.param_select.selectingRole == "master"){
                    this.master = new WebrtcMaster(this.signalingUrl);
                    await this.start_master(this.currentChannelId, this.currentClientId, this.param_select.password);
                }else if( this.param_select.selectingRole == "slave"){
                    this.slave = new WebrtcSlave(this.signalingUrl);
                    await this.start_slave(this.currentChannelId, this.currentClientId, this.param_select.password, false);
                }else if( this.param_select.selectingRole == "direct" ){
                    this.slave = new WebrtcSlave(this.signalingUrl);
                    await this.start_slave(this.currentChannelId, this.currentClientId, this.param_select.password, true);
                }
                localStorage.setItem(configName_clientId, this.param_select.clientId);
                localStorage.setItem(configName_channelId, this.param_select.channelId);
                localStorage.setItem(configName_password, this.param_select.password);
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        connect_direct: async function(remoteClient){
            this.dialog_close('#client_list_dialog');

            this.currentRemoteClient = remoteClient;
            this.slave.connect(remoteClient.clientId, { localStream: this.localStream, dataLabel: this.dataLabel});
        },
        open_client_list: async function(){
            var input = {
                method: "GET",
                url: "/signaling-get-client",
                qs: {
                    channelId: this.currentChannelId
                }
            };
            var result = await do_http(input);
            console.log(result);
            this.clientList = result.client_list;
            this.dialog_open("#client_list_dialog");
        },

        select_remoteClient: async function(){
            if( this.selectedRemoteClient ){
                var mediaStream = this.master.getMediaStream(this.selectedRemoteClient.clientId);
                if( mediaStream ){
                    const video = document.querySelector('#remotecamera_view');
                    video.srcObject = mediaStream;
                }
            }else{
                const video = document.querySelector('#remotecamera_view');
                video.srcObject = null;
            }
        },

        attach_video: async function(localstream_type){
            if( !localstream_type){
                this.localStream = null;
            }else
            if (localstream_type == 'screen') {
                this.localStream = await navigator.mediaDevices.getDisplayMedia({ video: {}, audio: true });
            } else{
                var facingMode = (localstream_type == 'camera_enviroment') ? 'environment' : 'user';
                const constraints = {
                    video: { facingMode: facingMode },
                    audio: { echoCancellation: true, noiseSuppression: true },
                };
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            }
            const video = document.querySelector('#localcamera_view');
            video.srcObject = this.localStream;
        },

        connect_slave: async function (remoteClient) {
            this.dialog_close('#connect_dialog');
            this.remoteClient = remoteClient;
            this.slave.connect(remoteClient.clientId, { localStream: this.localStream, dataLabel: this.dataLabel });
        },

        start_master: async function (channelId, clientId, password) {
            try{
                var params = {
                    localStream: this.localStream,
                    channelId: channelId,
                    clientId: this.currentClientId,
                    dataLabel: this.dataLabel,
                    password: password || "",
                    requestOffer: true
                };
                await this.master.start(params, (type, result) => {
                    console.log(type, result);
                    if (type == "peer") {
                        if (result.type == "sdpOffering") {
                            tracks = [];
                        } else
                        if (result.type == "track") {
                            this.remoteClientList = this.master.getRemoteClientList();
                            this.toast_show(result.remoteClientId + 'が接続されました。');
                        }else
                        if( result.type == "connectionstatechange") {
                            this.remoteClientList = this.master.getRemoteClientList();
                            if( result.connectionState == "disconnected")
                                this.toast_show(result.remoteClientId + "との接続が切断されました。");
                        }
                    }else if( type == "signaling" ){
                        if( result.type == "closed" ){
                            this.toast_show("接続が切断されました。");
                            this.remoteClientList = this.master.getRemoteClientList();
                        }else if( result.type == "error"){
                            this.toast_show(result.message);
                        }
                    }else if( type == "data" ){
                        if( result.type == "message" ){
                            this.dataMessageLog += `(${result.remoteClientId}) ${result.data}\n`;
                        }
                    }
                });
            }catch(error){
                this.toast_show(error);
            }
        },
        start_slave: async function (channelId, clientId, password, autoSlaveConnect) {
            try {
                var params = {
                    channelId: channelId,
                    clientId: clientId,
                    password: password || "",
                    localStream: this.localStream,
                    autoSlaveConnect: autoSlaveConnect,
                };
                await this.slave.start(params, (module, result) => {
                    console.log(module, result);
                    if (module == "peer") {
                        if (result.type == "sdpOffering") {
                            tracks = [];
                        } else
                        if (result.type == "track") {
                            if (result.kind == "audio") {
                                tracks.push(result.track);
                                var remoteView = document.querySelector('#remotecamera_view');
                                remoteView.srcObject = new MediaStream(tracks);
                            }else
                            if (result.kind == "video") {
                                tracks.push(result.track);
                                var remoteView = document.querySelector('#remotecamera_view');
                                remoteView.srcObject = new MediaStream(tracks);
                            }
                        }else
                        if( result.type == "connectionstatechange") {
                            if( result.connectionState == "disconnected"){
                                this.toast_show("接続が切断されました。");
                            }
                        }
                    } else if (module == "signaling") {
                        if (result.type == "ready") {
                            if( this.currentRole == "slave"){
                                if (result.remoteClientList.length == 0) {
                                }else{
                                    this.selectingRemoteClientList = result.remoteClientList;
                                    this.dialog_open("#connect_dialog");
                                }
                            }
                        }else if( result.type == "requestOffer" ){
                            return { localStream: this.localStream, dataLabel: this.dataLabel}
                        }else if( result.type == "closed" ){
                            this.toast_show("接続が切断されました。");
                        }else if( result.type == "error"){
                            this.toast_show(result.message);
                        }
                    }else if( module == "data" ){
                        if( result.type == "message"){
                            this.dataMessageLog += `${result.data}\n`;
                        }
                    }
                });
            } catch (error) {
                console.error(error);
                this.toast_show(error);
            }
        },
        sendDataMessage: async function(){
            console.log("sendDataMessage called");
            if(this.currentRole == "master"){
                if( this.selectedRemoteClient)
                    this.master.sendMessage(this.dataMessage, this.selectedRemoteClient.clientId);
                else
                    this.master.sendMessage(this.dataMessage);
            }else if( this.currentRole == "slave"){
                this.slave.sendMessage(this.dataMessage);
            }
        },
        onResize: function () {
            this.$nextTick(() => {
                var video = document.querySelector('#remotecamera_view');
                var width = document.querySelector('#div_remotecamera_view').clientWidth;
                video.width = width;
                var video = document.querySelector('#localcamera_view');
                var width = document.querySelector('#div_localcamera_view').clientWidth;
                video.width = width;
            });
        },
    },
    created: function () {
    },
    mounted: function () {
        proc_load();

        if (navigator.mediaDevices.getDisplayMedia)
            this.has_displaymedia = true;

        this.onResize();
        window.addEventListener('resize', this.onResize);

        this.signalingUrl = ((location.protocol == "https:") ? "wss://" : "ws://") + location.host + "/signaling";
        this.param_select = {
            clientId: localStorage.getItem(configName_clientId) || "test",
            selectingRole: "slave",
            localstream_type: "",
            channelId: localStorage.getItem(configName_channelId) || "",
            password: localStorage.getItem(configName_password) || ""
        };
        this.dialog_open("#select_role_dialog");
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */

window.vue = new Vue(vue_options);
