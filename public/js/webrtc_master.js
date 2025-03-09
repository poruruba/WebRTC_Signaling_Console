class WebrtcMaster {
    constructor(signalingUrl){
        this.signalingUrl = signalingUrl;
        this.peerList = [];
        this.signalingClient = null;
    }
    
    // params: localStream, channelId, clientId, password, dataLabel, requestOffer
    async start(params, callback) {
        this.stop();

        this.signalingClient = new WebrtcSignalingClient("master", this.signalingUrl);

        this.signalingClient.on('open', async () => {
            if (callback) callback('signaling', { type: 'opened' });
        });

        this.signalingClient.on('close', async () => {
            if (callback) callback('signaling', { type: 'closed' });
        });

        this.signalingClient.on('error', async (message) => {
            if (callback) callback('signaling', { type: 'error', message: message });
        });

        this.signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
            if (candidate){
                var peer = this.peerList.find(item => item.clientId == remoteClientId);
                if( peer )
                    await peer.peerConnection.addIceCandidate(candidate);
            }
        });

        this.signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
            var peer = this.peerList.find(item => item.clientId == remoteClientId );
            if( peer )
                peer.peerConnection.close();

            const iceServers = [];
            iceServers.push({ urls: `stun:stun.l.google.com:19302` });
            const configuration = {
                iceServers,
                iceTransportPolicy: 'all',
            };
            var peerConnection = new RTCPeerConnection(configuration);
            if( peer ){
                peer.peerConnection = peerConnection;
                peer.tracks = [];
                peer.dataChannel = null;
            }else{
                peer = {
                    clientId: remoteClientId,
                    peerConnection: peerConnection,
                    tracks: [],
                    dataChannel: null
                };
                this.peerList.push(peer);
            }
            
            await peerConnection.setRemoteDescription(offer);
            if (callback) callback('peer', { type: 'sdpOffered', remoteClientId: remoteClientId });

            if (params.dataLabel) {
                peer.dataChannel = peerConnection.createDataChannel(params.dataLabel);
                peerConnection.addEventListener("datachannel", event => {
                    event.channel.addEventListener("message", (e) => {
                        if (callback)
                            callback("data", { type: 'message', remoteClientId: remoteClientId, data: e.data, label: e.target.label });
                    });
                });
            }

            params.localStream.getTracks().forEach(track => peerConnection.addTrack(track, params.localStream));

            peerConnection.addEventListener('track', event => {
                peer.tracks.push(event.track);
                if (callback) callback('peer', { type: 'track', remoteClientId: remoteClientId, kind: event.track.kind, streams: event.streams, track: event.track });
            });

            peerConnection.addEventListener('icecandidate', async ({ candidate }) => {
                this.signalingClient.sendIceCandidate(candidate, remoteClientId);
            });

            peerConnection.addEventListener('connectionstatechange', (event) => {
                if (callback) callback('peer', { type: 'connectionstatechange', remoteClientId: remoteClientId, connectionState: event.target.connectionState });
            });
            peerConnection.addEventListener('negotiationneeded', (event) => {
                if (callback) callback('peer', { type: 'negotiationneeded', remoteClientId: remoteClientId });
            });
            peerConnection.addEventListener('icegatheringstatechange', (event) => {
                if (callback) callback('peer', { type: 'icegatheringstatechange', remoteClientId: remoteClientId, iceGatheringState: event.target.iceGatheringState });
            });
            peerConnection.addEventListener('iceconnectionstatechange', (event) => {
                if (callback) callback('peer', { type: 'iceconnectionstatechange', remoteClientId: remoteClientId, iceConnectionState: event.target.iceConnectionState });
            });
            peerConnection.addEventListener('icecandidateerror', (event) => {
                if (callback) callback('peer', { type: 'icecandidateerror', remoteClientId: remoteClientId });
            });
            peerConnection.addEventListener('signalingstatechange', (event) => {
                if (callback) callback('peer', { type: 'signalingstatechange', remoteClientId: remoteClientId, signalingState: event.target.signalingState });
            });

            var answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.signalingClient.sendSdpAnswer(answer, remoteClientId);
            if (callback) callback('peer', { type: 'sdpAnswering', remoteClientId: remoteClientId });

            if( params.requestOffer ){
                this.signalingClient.on('sdpAnswer', async answer => {
                    if (peerConnection) {
                        await peerConnection.setRemoteDescription(answer);
                        if (callback) callback('peer', { type: 'sdpAnswered', remoteClientId: remoteClientId });
                    }
                });

                var offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                });
                await peerConnection.setLocalDescription(offer);

                this.signalingClient.sendSdpOffer(offer, remoteClientId);
                if (callback) callback('peer', { type: 'sdpOffering', remoteClientId: remoteClientId });
            }
        });

        this.signalingClient.open(params.channelId, params.clientId, params.password);
        if (callback) callback('signaling', { type: 'opening' });
    }

    getRemoteClientList(){
        return this.peerList;
    }

    getMediaStream(remoteClientId){
        var peer = this.peerList.find(item => item.clientId == remoteClientId);
        return new MediaStream(peer.tracks);
    }

    disconnect(remoteClientId) {
        var peerIndex = this.peerList.findIndex(item => item.clientId == remoteClientId);
        if (peerIndex) {
            this.peerList[peerIndex].peerConnection.close();
            this.peerList.splice(peerIndex, 1);
        }
    }

    stop() {
        if (this.signalingClient) {
            this.signalingClient.close();
            this.signalingClient = null;
        }

        for( let item of this.peerList){
            item.peerConnection.close();
        }
        this.peerList = [];
        this.clientId = null;
        this.channelId = null;
    }

    sendMessage(message, remoteClientId) {
//        console.log("call: sendMasterMessage");

        if (remoteClientId) {
            var peer = this.peerList.find(item => item.clientId == remoteClientId);
            if (!peer)
                throw new Error("client not found");

            if (!peer.dataChannel || peer.dataChannel.readyState != "open")
                throw new Error("client not ready");

            peer.dataChannel.send(message);
        } else {
            for( let item of this.peerList){
                try {
                    if (item && item.dataChannel && item.dataChannel.readyState == 'open')
                        item.dataChannel.send(message);
                } catch (e) {
                    console.log(e);
                }
            }
        }
    }
}