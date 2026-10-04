package requests

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"mime/multipart"
	"net/textproto"
	"slices"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

func (h *Handler) GetValidationFiles(ctx context.Context, req generated.GetValidationFilesRequestObject) (generated.GetValidationFilesResponseObject, error) {
	actor := httpauth.Actor(ctx)
	files, err := h.requests.GetValidationFiles(ctx, req.RequestId, actor.ID, store.Role(actor.Role))
	if err != nil {
		return nil, validationReadError(err)
	}
	metadata, contents := validationFiles(files)
	write, err := fileMultipart(metadata, contents)
	if err != nil {
		return nil, err
	}
	return generated.GetValidationFiles200MultipartResponse(write), nil
}

func (h *Handler) GetValidationArtifacts(ctx context.Context, req generated.GetValidationArtifactsRequestObject) (generated.GetValidationArtifactsResponseObject, error) {
	actor := httpauth.Actor(ctx)
	files, err := h.requests.GetValidationArtifacts(ctx, req.RequestId, actor.ID, store.Role(actor.Role))
	if err != nil {
		return nil, validationReadError(err)
	}
	metadata, contents := artifactFiles(files)
	write, err := fileMultipart(metadata, contents)
	if err != nil {
		return nil, err
	}
	return generated.GetValidationArtifacts200MultipartResponse(write), nil
}

func artifactFiles(files store.ValidationArtifacts) (generated.ValidationArtifactsMetadata, []downloadFile) {
	metadata := generated.ValidationArtifactsMetadata{
		Files: []generated.ArtifactPart{},
	}
	contents := []downloadFile{}
	for _, file := range files.Files {
		job := files.Resource.Workflows[file.WorkflowID].Jobs[file.JobID]
		if job.Visibility != "public" || job.Artifacts == nil {
			continue
		}
		for _, output := range job.Artifacts.Outputs {
			if output.Name != file.Name || output.Visibility != "public" {
				continue
			}
			part := fmt.Sprintf("file%d", len(contents))
			metadata.Files = append(metadata.Files, generated.ArtifactPart{
				Part:        part,
				Path:        string(output.Path),
				WorkflowId:  file.WorkflowID,
				JobId:       file.JobID,
				Name:        file.Name,
				ContentType: output.ContentType,
			})
			contents = append(contents, downloadFile{
				content:     file.Content,
				contentType: output.ContentType,
			})
		}
	}
	return metadata, contents
}

type downloadFile struct {
	content     []byte
	contentType string
}

func validationFiles(files store.ValidationFiles) (generated.ValidationFilesMetadata, []downloadFile) {
	metadata := generated.ValidationFilesMetadata{
		SubmissionFiles: []generated.FilePart{},
		Presets:         []generated.PresetFiles{},
	}
	contents := []downloadFile{}
	add := func(path string, content []byte) generated.FilePart {
		part := fmt.Sprintf("file%d", len(contents))
		contents = append(contents, downloadFile{
			content:     content,
			contentType: "application/octet-stream",
		})
		return generated.FilePart{Part: part, Path: path}
	}
	for _, file := range files.Submission {
		metadata.SubmissionFiles = append(metadata.SubmissionFiles, add(file.Path, file.Content))
	}
	for _, id := range slices.Sorted(maps.Keys(files.Resource.Workflows)) {
		group := generated.PresetFiles{WorkflowId: id, Files: []generated.FilePart{}}
		for _, file := range files.Resource.Workflows[id].Presets {
			group.Files = append(group.Files, add(string(file.Path), file.Content))
		}
		metadata.Presets = append(metadata.Presets, group)
	}
	return metadata, contents
}

// Encode metadata before committing response headers. File bytes are written
// directly to multipart without another aggregate buffer or base64 expansion.
func fileMultipart(metadata any, files []downloadFile) (func(*multipart.Writer) error, error) {
	data, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("encode file metadata: %w", err)
	}
	return func(writer *multipart.Writer) error {
		part, err := writer.CreatePart(textproto.MIMEHeader{
			"Content-Disposition": {`form-data; name="metadata"`},
			"Content-Type":        {"application/json"},
		})
		if err != nil {
			return err
		}
		if _, err := part.Write(data); err != nil {
			return err
		}
		for i, file := range files {
			part, err := writer.CreatePart(textproto.MIMEHeader{
				"Content-Disposition": {fmt.Sprintf(`form-data; name="file%d"; filename="file%d"`, i, i)},
				"Content-Type":        {file.contentType},
			})
			if err != nil {
				return err
			}
			if _, err := part.Write(file.content); err != nil {
				return err
			}
		}
		return nil
	}, nil
}
