package database

import (
	"context"
	"errors"

	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/requeststatus"
	"github.com/uptrace/bun"
)

type RequestStore struct {
	db *bun.DB
}

func (r RequestStore) UpdateGradingRequestStatus(ctx context.Context, id int64, e requeststatus.State) error {
	_, err := r.db.NewUpdate().Model(&model.GradingRequest{}).Set("result = ?", int64(e)).Where("id = ?", id).Exec(ctx)
	return err
}

func (r RequestStore) UpdateValidationRequestStatus(ctx context.Context, id int64, status_id requeststatus.State) error {
	_, err := r.db.NewUpdate().Model(&model.ValidationRequest{}).Set("result = ?", int64(status_id)).Where("id = ?", id).Exec(ctx)
	return err
}

func (r *RequestStore) RegisterValidationRequest(ctx context.Context, request *model.ValidationRequest) error {
	_, err := r.db.NewInsert().Model(request).Returning("id"). // Return auto-incremented ID
									Exec(ctx)
	return err
}

func (r *RequestStore) RegisterOrUpdateGradingRequest(ctx context.Context, request *model.GradingRequest) error {
	_, err := r.db.NewInsert().Model(request).On("CONFLICT (lecture_id,problem_id,usercode,submission_ts) DO UPDATE"). // Upsert
																Returning("id"). // Return auto-incremented ID
																Exec(ctx)
	return err
}

func (r *RequestStore) UpdateResultOfValidationRequest(ctx context.Context, id int64, result_id requeststatus.State, Log model.RequestLog) error {
	_, err := r.db.NewUpdate().Model(&model.ValidationRequest{}).
		Set("result = ?", int64(result_id)).
		Set("log = ?", Log).
		Where("id = ?", id).
		Exec(ctx)
	return err
}

func (r *RequestStore) UpdateResultOfGradingRequest(ctx context.Context, id int64, result_id requeststatus.State, Log model.RequestLog) error {
	_, err := r.db.NewUpdate().Model(&model.GradingRequest{}).
		Set("result = ?", int64(result_id)).
		Set("log = ?", Log).
		Where("id = ?", id).
		Exec(ctx)
	return err
}

type Direction string

const (
	DirectionNext Direction = "next"
	DirectionPrev Direction = "prev"
)

// GetValidationResults retrieves validation results for a user filtered by allowed lecture IDs, with pagination support.
//
// usercode: If non-negative, filters results to only those submitted by the specified user. If negative, retrieves results for all users.
// lecture_ids: List of lecture IDs that the user is allowed to access.
// last: The ID of the last record from the previous page. For "next" direction, fetches records with IDs less than this value. For "prev" direction, fetches records with IDs greater than this value.
// limit: Maximum number of records to retrieve.
// direction: "next" to fetch older records (IDs less than 'last'), "prev" to fetch newer records (IDs greater than 'last').
//
// Returns a slice of ValidationRequest and an error if any.
// NOTE: This function does not utilize OFFSET, because OFFSET can be inefficient for large datasets.
func (r *RequestStore) GetValidationResults(ctx context.Context, usercode int64, lecture_ids []int64, Anchor int64, limit int, direction Direction) ([]model.ValidationRequest, error) {
	var results []model.ValidationRequest

	intermediate := r.db.NewSelect().Model(&results).Relation("User").Where("lecture_id IN (?)", bun.In(lecture_ids))

	if usercode >= 0 {
		intermediate = intermediate.Where("usercode = ?", usercode)
	}

	switch direction {
	case DirectionNext:
		intermediate = intermediate.Where("validation_request.id < ?", Anchor).Order("validation_request.id DESC")
	case DirectionPrev:
		intermediate = intermediate.Where("validation_request.id > ?", Anchor).Order("validation_request.id ASC")
	default:
		return nil, errors.New("invalid direction")
	}

	err := intermediate.Limit(limit).Scan(ctx)
	return results, err
}

func (r *RequestStore) GetValidationResultByID(ctx context.Context, id int64) (*model.ValidationRequest, error) {
	var result model.ValidationRequest
	err := r.db.NewSelect().Model(&result).Relation("FileLocation").Relation("User").Where("validation_request.id = ?", id).Scan(ctx)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieves entire grading results for a lecture, ordered by usercode and submission timestamp.
// This is intended for grading staff to review all submissions for a particular lecture.
func (r *RequestStore) GetGradingResults(ctx context.Context, lecture_id int64) ([]model.GradingRequest, error) {
	var results []model.GradingRequest
	err := r.db.NewSelect().Model(&results).
		Relation("SubjectUser").
		Relation("FileLocation").
		Where("lecture_id = ?", lecture_id).
		Order("usercode ASC", "submission_ts ASC").
		Scan(ctx)

	return results, err
}

func (r *RequestStore) GetGradingResultsByLectureIDAndUserCode(ctx context.Context, lecture_id int64, usercode int64) ([]model.GradingRequest, error) {
	var results []model.GradingRequest
	err := r.db.NewSelect().Model(&results).
		Relation("FileLocation").
		Relation("RequestUser").
		Where("lecture_id = ? AND usercode = ?", lecture_id, usercode).
		Order("submission_ts DESC", "problem_id ASC").
		Scan(ctx)

	return results, err
}

func (r *RequestStore) GetGradingResultByID(ctx context.Context, id int64) (*model.GradingRequest, error) {
	var result model.GradingRequest
	err := r.db.NewSelect().Model(&result).Where("grading_request.id = ?", id).Scan(ctx)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func NewRequestStore(db *bun.DB) *RequestStore {
	return &RequestStore{
		db: db,
	}
}
